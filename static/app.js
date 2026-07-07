document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const dragZone = document.getElementById('drag-zone');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');
    const fileStatusCard = document.getElementById('file-status-card');
    const fileIcon = document.getElementById('file-icon');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const removeFileBtn = document.getElementById('remove-file-btn');
    const progressBar = document.getElementById('progress-bar');
    const statusMessage = document.getElementById('status-message');
    
    const chunkSizeSlider = document.getElementById('chunk-size');
    const chunkSizeVal = document.getElementById('chunk-size-val');
    const chunkOverlapSlider = document.getElementById('chunk-overlap');
    const chunkOverlapVal = document.getElementById('chunk-overlap-val');
    
    const statsChunks = document.getElementById('stats-chunks');
    const statsFilename = document.getElementById('stats-filename');
    const clearDbBtn = document.getElementById('clear-db-btn');
    
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    
    const chatHistory = document.getElementById('chat-history');
    const queryInput = document.getElementById('query-input');
    const sendBtn = document.getElementById('send-btn');
    const suggestionChips = document.getElementById('suggestion-chips');

    // App State
    let isDocumentLoaded = false;
    let currentFileName = '';

    // Initialize UI on load
    checkBackendStatus();

    // Slider Event Listeners
    chunkSizeSlider.addEventListener('input', (e) => {
        chunkSizeVal.textContent = `${e.target.value} chars`;
    });

    chunkOverlapSlider.addEventListener('input', (e) => {
        chunkOverlapVal.textContent = `${e.target.value} chars`;
    });

    let lastDropTime = 0;

    // File Selection Trigger
    dragZone.addEventListener('click', (e) => {
        // Prevent opening the file browser dialog if a drop event occurred just now
        if (Date.now() - lastDropTime < 150) return;
        fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });

    // Drag and Drop Events
    ['dragenter', 'dragover'].forEach(eventName => {
        dragZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragZone.classList.add('dragover');
        }, false);
    });

    dragZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragZone.classList.remove('dragover');
    });

    dragZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragZone.classList.remove('dragover');
        lastDropTime = Date.now();

        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    });

    // Remove File click
    removeFileBtn.addEventListener('click', resetDatabase);
    clearDbBtn.addEventListener('click', resetDatabase);

    // Auto-resize Textarea & Input logic
    queryInput.addEventListener('input', () => {
        queryInput.style.height = 'auto';
        queryInput.style.height = (queryInput.scrollHeight - 12) + 'px';
        
        if (queryInput.value.trim() && isDocumentLoaded) {
            sendBtn.removeAttribute('disabled');
            sendBtn.classList.add('active');
        } else {
            sendBtn.setAttribute('disabled', 'true');
            sendBtn.classList.remove('active');
        }
    });

    // Handle Enter inside textarea
    queryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitQuery();
        }
    });

    sendBtn.addEventListener('click', submitQuery);

    // Suggestion Chips Click
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const query = chip.getAttribute('data-query');
            queryInput.value = query;
            queryInput.dispatchEvent(new Event('input'));
            submitQuery();
        });
    });

    // --- Core Functions ---

    // Fetch initial status from Backend
    async function checkBackendStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            
            if (data.is_loaded) {
                setDocumentLoadedState(data.filename, data.chunks_count);
            } else {
                setDocumentClearedState();
            }
        } catch (err) {
            console.error('Failed to get status:', err);
            showSystemMessage('system', 'Connection Error', 'Could not establish connection with RAG server. Make sure the server is running.');
        }
    }

    // Handles uploading and chunking workflow
    async function handleFileUpload(file) {
        // Validation
        const validExtensions = ['.pdf', '.txt'];
        const fileNameLower = file.name.toLowerCase();
        const isValid = validExtensions.some(ext => fileNameLower.endsWith(ext));

        if (!isValid) {
            alert('Unsupported file type. Please upload a PDF or TXT file.');
            return;
        }

        if (file.size > 25 * 1024 * 1024) {
            alert('File size exceeds the 25MB limit.');
            return;
        }

        // Show File Info Card
        dragZone.style.display = 'none';
        fileStatusCard.style.display = 'block';
        fileName.textContent = file.name;
        fileSize.textContent = formatBytes(file.size);
        
        // Adjust icon type
        if (fileNameLower.endsWith('.txt')) {
            fileIcon.className = 'fa-solid fa-file-lines file-icon';
        } else {
            fileIcon.className = 'fa-solid fa-file-pdf file-icon';
        }

        // Update indicators to "Processing"
        statusDot.className = 'status-dot loading';
        statusText.textContent = 'Parsing & Indexing...';
        statusMessage.textContent = 'Uploading to server...';
        progressBar.style.width = '20%';

        // Prepare FormData
        const formData = new FormData();
        formData.append('file', file);
        formData.append('chunk_size', chunkSizeSlider.value);
        formData.append('chunk_overlap', chunkOverlapSlider.value);

        try {
            // Fake upload progress smoothing
            setTimeout(() => { progressBar.style.width = '50%'; statusMessage.textContent = 'Chunking text...'; }, 600);
            setTimeout(() => { progressBar.style.width = '75%'; statusMessage.textContent = 'Generating embeddings...'; }, 1500);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Server error during parsing');
            }

            const data = await response.json();
            progressBar.style.width = '100%';
            statusMessage.textContent = 'Ready!';
            
            setDocumentLoadedState(file.name, data.chunks_count);
            showSystemMessage('system', 'Document Parsed Successfully', `Loaded "${file.name}" and split it into ${data.chunks_count} chunks.`);
            
        } catch (error) {
            console.error('Upload failed:', error);
            statusDot.className = 'status-dot inactive';
            statusText.textContent = 'Parsing Failed';
            statusMessage.textContent = 'Error occurred';
            progressBar.style.width = '0%';
            
            showSystemMessage('error', 'Error Processing Document', error.message || 'An error occurred while uploading/parsing your file.');
            
            // Re-enable drag-zone
            setTimeout(() => {
                dragZone.style.display = 'block';
                fileStatusCard.style.display = 'none';
            }, 3000);
        }
    }

    // Submit Query to RAG Pipeline
    async function submitQuery() {
        const query = queryInput.value.trim();
        if (!query || !isDocumentLoaded) return;

        // Clear input & reset textarea size
        queryInput.value = '';
        queryInput.style.height = 'auto';
        sendBtn.setAttribute('disabled', 'true');
        sendBtn.classList.remove('active');

        // Add user message bubble
        addMessageBubble('user', query);

        // Add AI typing indicator
        const typingIndicatorId = addTypingIndicator();

        try {
            const response = await fetch('/api/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: query })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Server responded with an error');
            }

            const data = await response.json();
            
            // Remove typing indicator
            removeTypingIndicator(typingIndicatorId);

            // Add AI bubble with answer and sources
            addMessageBubble('ai', data.answer, data.sources);

        } catch (error) {
            console.error('Query failed:', error);
            removeTypingIndicator(typingIndicatorId);
            addMessageBubble('ai', `Sorry, I encountered an error while processing your request: "${error.message}". Please try again.`);
        }
    }

    // Reset Database on Backend & Front
    async function resetDatabase() {
        if (!confirm('Are you sure you want to clear the active database? This will remove all loaded document indexes.')) {
            return;
        }

        try {
            const res = await fetch('/api/clear', { method: 'POST' });
            if (res.ok) {
                setDocumentClearedState();
                showSystemMessage('system', 'Database Cleared', 'All document embedding vectors have been removed.');
            }
        } catch (error) {
            console.error('Failed to clear database:', error);
            alert('Failed to clear database: ' + error.message);
        }
    }

    // --- State setters ---

    function setDocumentLoadedState(filename, chunks) {
        isDocumentLoaded = true;
        currentFileName = filename;

        // Status Header
        statusDot.className = 'status-dot active';
        statusText.textContent = 'Document Ready';

        // Stats card
        statsChunks.textContent = chunks;
        statsFilename.textContent = filename;
        statsFilename.title = filename;

        // File Card (if it was hidden, show it)
        dragZone.style.display = 'none';
        fileStatusCard.style.display = 'block';
        fileName.textContent = filename;
        fileSize.textContent = 'Indexed';
        if (filename.toLowerCase().endsWith('.txt')) {
            fileIcon.className = 'fa-solid fa-file-lines file-icon';
        } else {
            fileIcon.className = 'fa-solid fa-file-pdf file-icon';
        }
        progressBar.style.width = '100%';
        statusMessage.textContent = 'Document loaded';

        // Input enablement
        queryInput.removeAttribute('disabled');
        queryInput.placeholder = 'Ask a question about the document...';
        queryInput.focus();

        // Suggestions
        suggestionChips.style.display = 'flex';
    }

    function setDocumentClearedState() {
        isDocumentLoaded = false;
        currentFileName = '';

        // Status Header
        statusDot.className = 'status-dot inactive';
        statusText.textContent = 'No Document Loaded';

        // Stats
        statsChunks.textContent = '0';
        statsFilename.textContent = 'None';
        statsFilename.title = '';

        // File Card hide, Drag-zone show
        dragZone.style.display = 'block';
        fileStatusCard.style.display = 'none';
        fileInput.value = ''; // Reset input element

        // Input disable
        queryInput.value = '';
        queryInput.style.height = 'auto';
        queryInput.setAttribute('disabled', 'true');
        queryInput.placeholder = 'Upload a document to unlock chat...';
        sendBtn.setAttribute('disabled', 'true');
        sendBtn.classList.remove('active');

        // Suggestions
        suggestionChips.style.display = 'none';
    }

    // --- UI Utilities ---

    function addMessageBubble(sender, text, sources = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message message-${sender}`;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = sender === 'user' ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        
        if (sender === 'ai') {
            // Render markdown using Marked
            bubble.innerHTML = marked.parse(text);
        } else {
            // User message: keep as plain text with escaped HTML and line breaks
            const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            bubble.innerHTML = `<p>${escapedText}</p>`;
        }

        // Append Sources if present
        if (sources && sources.length > 0) {
            const sourcesDiv = document.createElement('div');
            sourcesDiv.className = 'message-sources';
            sourcesDiv.innerHTML = `<div class="sources-title"><i class="fa-solid fa-book-open"></i> Sources Citations</div>`;
            
            const sourcesList = document.createElement('div');
            sourcesList.className = 'sources-list';
            
            sources.forEach((src, idx) => {
                const escapedSrc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                const srcItem = document.createElement('div');
                srcItem.className = 'source-item';
                srcItem.innerHTML = `<strong>Chunk ${idx + 1}:</strong> ${escapedSrc}`;
                sourcesList.appendChild(srcItem);
            });
            
            sourcesDiv.appendChild(sourcesList);
            bubble.appendChild(sourcesDiv);
        }

        // Render LaTeX Math equations in the bubble if AI message
        if (sender === 'ai') {
            try {
                renderMathInElement(bubble, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false},
                        {left: '\\[', right: '\\]', display: true}
                    ],
                    throwOnError: false
                });
            } catch (err) {
                console.error("KaTeX error:", err);
            }
        }

        messageDiv.appendChild(avatar);
        messageDiv.appendChild(bubble);

        chatHistory.appendChild(messageDiv);
        scrollToBottom();
    }

    function addTypingIndicator() {
        const id = 'typing-' + Date.now();
        const indicatorDiv = document.createElement('div');
        indicatorDiv.className = 'message message-ai';
        indicatorDiv.id = id;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = '<i class="fa-solid fa-robot"></i>';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        
        const loader = document.createElement('div');
        loader.className = 'typing-indicator';
        loader.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;

        bubble.appendChild(loader);
        indicatorDiv.appendChild(avatar);
        indicatorDiv.appendChild(bubble);
        
        chatHistory.appendChild(indicatorDiv);
        scrollToBottom();
        return id;
    }

    function removeTypingIndicator(id) {
        const indicator = document.getElementById(id);
        if (indicator) {
            indicator.remove();
        }
    }

    function showSystemMessage(type, title, text) {
        const welcomeArea = document.querySelector('.system-welcome');
        if (welcomeArea) {
            // Remove the initial welcome text when real activities start
            welcomeArea.style.display = 'none';
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = 'message message-ai';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = type === 'error' ? '<i class="fa-solid fa-triangle-exclamation" style="color: #ff5252;"></i>' : '<i class="fa-solid fa-circle-info"></i>';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.style.borderLeft = type === 'error' ? '3px solid #ff5252' : '3px solid #00f2fe';
        
        const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const escapedText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        bubble.innerHTML = `<h4 style="margin-bottom: 5px; font-weight: 700; color: ${type === 'error' ? '#ff5252' : 'var(--accent-color)'}">${escapedTitle}</h4><p>${escapedText}</p>`;

        msgDiv.appendChild(avatar);
        msgDiv.appendChild(bubble);
        chatHistory.appendChild(msgDiv);
        scrollToBottom();
    }

    function scrollToBottom() {
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function formatBytes(bytes, decimals = 1) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
});
