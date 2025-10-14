// Get DOM elements
const chatBox = document.getElementById('chat-box');
const chatToggle = document.getElementById('chat-toggle');
const chatHistory = document.getElementById('chat-history');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const newChatButton = document.getElementById('new-chat-button');
const quickRepliesContainer = document.getElementById('quick-replies');
const QUICK_REPLIES = [
    "今天的市場觀點是什麼？",
    "玉山智見是什麼？",
    "如何使用玉山智見？",
];
// Typing speed (in ms)
const TYPING_SPEED = 30; 
// Initial welcome message text
const INITIAL_WELCOME_TEXT = "歡迎使用玉山智見，今天想問甚麼問題呢？";

const API_URL = 'https://api-gateway-227719466535.us-central1.run.app/api/chat'; 

let currentApiSessionId = null;

let currentMessages = [];


// --- 1. API 呼叫 ---

async function agentEngineApiCall(input) {
    
    const requestBody = {
        "message": input 
    };

    if (currentApiSessionId) {
        requestBody["session_id"] = currentApiSessionId;
    }
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        const botMessage = data.response?.[0]?.content || 
                           data.history?.[data.history.length - 1]?.content ||
                           'API 回覆無內容';
        const newSessionId = data.session_id;

        return { 
            success: true, 
            message: botMessage,
            newSessionId: newSessionId
        };

    } catch (error) {
        console.error("Cloud Run API 呼叫失敗:", error);
        throw new Error("無法連接 Cloud Run API 或伺服器錯誤。");
    }
}


// --- 2. 訊息處理與打字特效 ---

/**
 * Create and append message element
 * @param {string} content
 * @param {string} sender 
 * @param {boolean} isPreTyped - 是否已預先輸入內容 (用於載入歷史紀錄)
 * @returns {HTMLElement}
 */
function createMessageElement(content, sender, isPreTyped = false) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');

    if (sender === 'user') {
        messageDiv.classList.add('user-message');
        messageDiv.textContent = content;
        
    } else {
        messageDiv.classList.add('bot-message');
        // 僅對新訊息/打字時使用 typing-target
        messageDiv.innerHTML = `<span class="typing-target"></span>`;
    }

    chatHistory.appendChild(messageDiv);
    
    if (content !== '') {
        currentMessages.push({ sender: sender, content: content });
    }
    
    return messageDiv;
}

/**
 * Displays a dynamic typing indicator (e.g., ...) in the target element.
 * @param {HTMLElement} targetElement 
 * @returns {number} The interval ID to be used for clearing the indicator.
 */
function showTypingIndicator(targetElement) {
    let dots = '';
    targetElement.textContent = '思考中'; // 初始文字

    const intervalId = setInterval(() => {
        dots = (dots.length < 3) ? dots + '.' : '';
        targetElement.textContent = `思考中${dots}`;
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }, 400); // 每 400 毫秒變換一次

    return intervalId;
}

/**
 * @param {HTMLElement} targetElement - Target element for content
 * @param {string} text - Full message text
 */
function typeMessage(targetElement, text) {
    let index = 0;
    
    // 必須清除 typing-target 內容，避免重複
    targetElement.textContent = ''; 
    
    const intervalId = setInterval(() => {
        if (index < text.length) {
            targetElement.textContent += text.charAt(index);
            index++;
            chatHistory.scrollTop = chatHistory.scrollHeight; 
        } else {
            clearInterval(intervalId);
        }
    }, TYPING_SPEED);
}

/**
 * Render quick reply buttons
 */
function renderQuickReplies() {
    quickRepliesContainer.innerHTML = ''; // 清空現有按鈕
    
    // 邏輯：只有在聊天歷史是空的或只有初始 Bot 訊息時才顯示
    const MAX_INITIAL_MESSAGES = 3;
    const hasUserMessages = currentMessages.some(msg => msg.sender === 'user');
    if (hasUserMessages || chatHistory.children.length > MAX_INITIAL_MESSAGES) { //假設超過 3 條訊息就隱藏
        quickRepliesContainer.style.display = 'none';
        return;
    }
    
    quickRepliesContainer.style.display = 'flex';

    QUICK_REPLIES.forEach(text => {
        const button = document.createElement('button');
        button.classList.add('quick-reply-button');
        button.textContent = text;
        button.addEventListener('click', () => handleQuickReplyClick(text));
        quickRepliesContainer.appendChild(button);
    });
}

/**
 * Handle quick reply button click
 * @param {string} text 
 */
function handleQuickReplyClick(text) {
    userInput.value = text;
    handleSendMessage();
    
    quickRepliesContainer.style.display = 'none'; 
}

// --- 3. 浮動視窗的開啟/關閉邏輯 ---

function toggleChat() {
    chatBox.classList.toggle('collapsed');
    
    // 視窗開啟時，隱藏浮動圖標
    if (!chatBox.classList.contains('collapsed')) {
        chatToggle.style.display = 'none';
        // 如果是首次開啟且聊天歷史是空的，則初始化
        if (chatHistory.children.length === 0) {
             initializeChat();
        }
    } else {
        // 視窗關閉時，顯示浮動圖標
        chatToggle.style.display = 'flex';
    }
}

// --- 4. 流程控制 ---

function startNewConversation() {
    
    currentMessages = []; 
    chatHistory.innerHTML = '';
    currentApiSessionId = null;

    initializeChat();
}

/**
 * Initializes the chat when the page loads or starts a new conversation
 */
function initializeChat() {
    // 建立 bot 訊息容器
    const messageDiv = createMessageElement('', 'bot');
    const typingTarget = messageDiv.querySelector('.typing-target');
    
    // 開始打字顯示歡迎訊息
    typeMessage(typingTarget, INITIAL_WELCOME_TEXT);
    
    // 紀錄訊息
    currentMessages.push({ sender: 'bot', content: INITIAL_WELCOME_TEXT });
    
    // 顯示快速回覆
    renderQuickReplies();
    userInput.focus();
}

/**
 * Handle user message submission
 */
async function handleSendMessage() {
    const input = userInput.value.trim();

    if (input === "") { return; }

    // 1. 顯示使用者訊息 (此處 currentMessages 陣列會新增一條訊息)
    createMessageElement(input, 'user');

    // 2. 創建空的 Bot 訊息元素
    const botMessageElement = createMessageElement('', 'bot');
    const typingTarget = botMessageElement.querySelector('.typing-target');

    const typingIndicatorId = showTypingIndicator(typingTarget);

    // 3. 清空輸入並禁用按鈕
    userInput.value = '';
    sendButton.disabled = true;
    userInput.placeholder = "API 處理中..."; 

    try {
        // 4. 呼叫 API
        const response = await agentEngineApiCall(input);
        clearInterval(typingIndicatorId);

        if (response.newSessionId && !currentApiSessionId) {
            currentApiSessionId = response.newSessionId;
            console.log(`API 返回新的 Session ID: ${currentApiSessionId}`);
        }

        // 5. 顯示 API 回覆
        let botResponseText;
        if (response && response.message) {
            botResponseText = response.message;
            // 啟用打字效果
            typeMessage(typingTarget, botResponseText); 
        } else {
            botResponseText = "API 回覆格式錯誤或無內容。"; 
            typeMessage(typingTarget, botResponseText); 
        }
        
        // 6. 紀錄 Bot 訊息 (已經在 createMessageElement 中處理)

    } catch (error) {
        // 錯誤處理
        console.error("API failed:", error);
        clearInterval(typingIndicatorId);
        const errorMsg = "API 呼叫失敗，請檢查網路或 API 狀態。";
        typeMessage(typingTarget, errorMsg);
        currentMessages.push({ sender: 'bot', content: errorMsg });

    } finally {
        // 7. 重新啟用輸入
        setTimeout(() => {
            sendButton.disabled = false;
            userInput.placeholder = "在這裡輸入您的訊息..."; 
            userInput.focus();
        }, 1200); 
    }
}


// --- 5. 事件監聽  ---

chatToggle.addEventListener('click', toggleChat);

sendButton.addEventListener('click', handleSendMessage);

userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && !sendButton.disabled) { 
        event.preventDefault(); // 阻止 Enter 鍵換行
        handleSendMessage();
    }
});

newChatButton.addEventListener('click', startNewConversation);

document.getElementById('close-chat-btn').addEventListener('click', toggleChat);