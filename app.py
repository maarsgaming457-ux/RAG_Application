import os
import shutil
import json
from flask import Flask, request, jsonify, send_from_directory, render_template
from flask_cors import CORS
from flask import render_template
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# LangChain Imports
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_mistralai import MistralAIEmbeddings
from langchain_mistralai import ChatMistralAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.documents import Document

# Load environment variables
load_dotenv()

app = Flask(__name__, static_folder="static", template_folder=".")
CORS(app)

# Configuration
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
CHROMA_DIR = "/tmp/chroma_db"
STATUS_FILE = "/tmp/db_status.json"
ALLOWED_EXTENSIONS = {'pdf', 'txt'}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 25 * 1024 * 1024  # 25MB Max Upload

# Ensure directories exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Helper function to check allowed extensions
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Helper to read database status
def get_db_status():
    if os.path.exists(STATUS_FILE):
        try:
            with open(STATUS_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {"is_loaded": False, "filename": "None", "chunks_count": 0}

# Helper to write database status
def save_db_status(is_loaded, filename, chunks_count):
    status = {
        "is_loaded": is_loaded,
        "filename": filename,
        "chunks_count": chunks_count
    }
    with open(STATUS_FILE, 'w') as f:
        json.dump(status, f)

# Helper to completely purge Chroma directory and database
def purge_chroma_db():
    if os.path.exists(CHROMA_DIR):
        # Force delete the directory contents to clear lock files
        for i in range(3):  # Try a few times in case of Windows file locking
            try:
                shutil.rmtree(CHROMA_DIR)
                break
            except Exception as e:
                import time
                time.sleep(0.5)
    if os.path.exists(STATUS_FILE):
        try:
            os.remove(STATUS_FILE)
        except Exception:
            pass

# Serve Frontend Root
@app.route('/')
def index():
    return render_template("index.html")

# Get Current App Status
@app.route('/api/status', methods=['GET'])
def api_status():
    status = get_db_status()
    return jsonify(status)

# Upload and parse Document (PDF or TXT)
@app.route('/api/upload', methods=['POST'])
def api_upload():
    # Verify API key is available
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        return jsonify({"error": "Mistral AI API Key not found in server configuration. Please check your .env file."}), 500

    if 'file' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected for uploading"}), 400

    if not file or not allowed_file(file.filename):
        return jsonify({"error": "Invalid file type. Only PDF and TXT files are allowed."}), 400

    # Read configuration parameters
    chunk_size = int(request.form.get('chunk_size', 1000))
    chunk_overlap = int(request.form.get('chunk_overlap', 50))

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    try:
        # 1. Load document content
        docs = []
        file_ext = filename.rsplit('.', 1)[1].lower()

        if file_ext == 'pdf':
            loader = PyPDFLoader(filepath)
            docs = loader.load()
        elif file_ext == 'txt':
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                text_content = f.read()
            # Wrap text in a Langchain Document object
            docs = [Document(page_content=text_content, metadata={"source": filename})]

        # 2. Split document into chunks
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap
        )
        chunks = splitter.split_documents(docs)

        if not chunks:
            raise ValueError("No text content could be extracted from the uploaded file.")

        # 3. Clean existing Chroma database
        purge_chroma_db()

        # 4. Generate embeddings and store in Chroma
        embedding_model = MistralAIEmbeddings(api_key=api_key)
        vector = Chroma.from_documents(
            documents=chunks,
            embedding=embedding_model,
            persist_directory=CHROMA_DIR
        )
        # Save status
        save_db_status(True, filename, len(chunks))

        # Cleanup temporary uploaded file
        if os.path.exists(filepath):
            os.remove(filepath)

        return jsonify({
            "status": "success",
            "message": f"Successfully parsed and indexed {filename}",
            "chunks_count": len(chunks)
        })

    except Exception as e:
        # Cleanup uploaded file on error
        if os.path.exists(filepath):
            os.remove(filepath)
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Failed to process document: {str(e)}"}), 500

# Query RAG database
@app.route('/api/query', methods=['POST'])
def api_query():
    # Verify API key is available
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        return jsonify({"error": "Mistral AI API Key not found. Please check your .env file."}), 500

    status = get_db_status()
    if not status['is_loaded']:
        return jsonify({"error": "No document is currently loaded. Please upload a file first."}), 400

    data = request.get_json()
    if not data or 'question' not in data:
        return jsonify({"error": "Question parameter is required"}), 400

    question = data['question']

    try:
        # 1. Load Chroma DB
        embedding_model = MistralAIEmbeddings(api_key=api_key)
        vector = Chroma(
            persist_directory=CHROMA_DIR,
            embedding_function=embedding_model
        )

        # 2. Setup Retriever
        retriever = vector.as_retriever(
            search_type="mmr",
            search_kwargs={
                "k": 4,
                "fetch_k": 10,
                "lambda_mult": 0.5
            }
        )

        # 3. Retrieve relevant chunks
        docs = retriever.invoke(question)
        context = "\n\n".join([doc.page_content for doc in docs])

        # 4. Formulate LLM query
        llm = ChatMistralAI(model="mistral-small-2506", api_key=api_key)
        prompt = ChatPromptTemplate.from_messages([
            (
                "system",
                "You are a helpful AI assistant.\n"
                "Use only the provided context to answer the question.\n"
                "If the answer is not present in the context, "
                "say: \"I could not find the answer in the document.\"\n"
                "Do not make up facts outside the provided document context."
            ),
            (
                "human",
                "Context:\n{context}\n\n"
                "Question: {question}"
            )
        ])

        final_prompt = prompt.invoke({
            "context": context,
            "question": question
        })

        # 5. Get Answer
        response = llm.invoke(final_prompt)

        # Return answer and source contents
        return jsonify({
            "answer": response.content,
            "sources": [doc.page_content for doc in docs]
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"RAG Query failed: {str(e)}"}), 500

# Clear Chroma database
@app.route('/api/clear', methods=['POST'])
def api_clear():
    try:
        purge_chroma_db()
        return jsonify({"status": "success", "message": "Database successfully cleared"})
    except Exception as e:
        return jsonify({"error": f"Failed to clear database: {str(e)}"}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
