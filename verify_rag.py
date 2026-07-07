import io
import os
import json
import unittest
from app import app, get_db_status, STATUS_FILE, CHROMA_DIR

class TestRAGPipeline(unittest.TestCase):
    def setUp(self):
        # Configure app for testing
        app.config['TESTING'] = True
        self.client = app.test_client()
        
        # Verify API key is present
        self.api_key = os.getenv("MISTRAL_API_KEY")
        if not self.api_key:
            print("WARNING: MISTRAL_API_KEY not found in environment. Test query might fail.")

    def tearDown(self):
        # Clean up any leftover database files
        self.client.post('/api/clear')

    def test_status_endpoint(self):
        print("Testing /api/status endpoint...")
        response = self.client.get('/api/status')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('is_loaded', data)
        self.assertIn('filename', data)
        print("Status test passed.")

    def test_full_rag_workflow(self):
        if not self.api_key:
            print("Skipping full workflow test because MISTRAL_API_KEY is not set.")
            return

        print("Testing full RAG upload, search and query workflow...")
        
        # 1. Create a dummy text document with some specific facts
        fact_content = (
            "Project Antigravity is a high-tech agentic AI pair programming system "
            "designed by the Google DeepMind team. The secret launch code for the "
            "experimental engine is DEEPMIND-FLIGHT-99. It is designed to work in "
            "extreme conditions."
        )
        
        # 2. Upload file
        data = {
            'file': (io.BytesIO(fact_content.encode('utf-8')), 'test_facts.txt'),
            'chunk_size': '200',
            'chunk_overlap': '20'
        }
        
        print("Uploading test document to /api/upload...")
        response = self.client.post(
            '/api/upload',
            data=data,
            content_type='multipart/form-data'
        )
        
        self.assertEqual(response.status_code, 200)
        upload_data = json.loads(response.data)
        self.assertEqual(upload_data['status'], 'success')
        self.assertTrue(upload_data['chunks_count'] > 0)
        print(f"Upload successful. Total chunks indexed: {upload_data['chunks_count']}")

        # 3. Check status is updated
        response = self.client.get('/api/status')
        status_data = json.loads(response.data)
        self.assertTrue(status_data['is_loaded'])
        self.assertEqual(status_data['filename'], 'test_facts.txt')

        # 4. Ask a question that requires retrieving from the document
        query_payload = {
            "question": "What is the secret launch code for the experimental engine?"
        }
        print("Querying /api/query...")
        response = self.client.post(
            '/api/query',
            data=json.dumps(query_payload),
            content_type='application/json'
        )
        
        self.assertEqual(response.status_code, 200)
        query_data = json.loads(response.data)
        self.assertIn('answer', query_data)
        self.assertIn('sources', query_data)
        
        answer = query_data['answer'].lower()
        print(f"AI Answer: {query_data['answer']}")
        
        # Verify the answer retrieved the correct details
        self.assertTrue("deepmind-flight-99" in answer or "99" in answer)
        self.assertTrue(len(query_data['sources']) > 0)
        print("RAG query answer successfully validated.")

        # 5. Clear DB and verify status is reset
        print("Clearing database...")
        response = self.client.post('/api/clear')
        self.assertEqual(response.status_code, 200)
        
        response = self.client.get('/api/status')
        status_data = json.loads(response.data)
        self.assertFalse(status_data['is_loaded'])
        print("Cleanup successful.")

if __name__ == '__main__':
    unittest.main()
