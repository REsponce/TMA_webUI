// Get DOM elements
const chatHistory = document.getElementById('chat-history');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
// 新增 DOM 元素
const newChatButton = document.getElementById('new-chat-button');
const historyList = document.getElementById('history-list');

// Typing speed (in ms)
const TYPING_SPEED = 30; 
// Initial welcome message text
const INITIAL_WELCOME_TEXT = "歡迎使用 Demo。請輸入任何資訊，我會輸出內容並回覆您！";

const API_URL = 'https://api-gateway-227719466535.us-central1.run.app/api/chat'; // 替換為您的 Cloud Run API URL

let currentApiSessionId = null;

// 全局對話狀態
let conversations = []; // 儲存所有對話紀錄
let currentChatId = null; // 當前對話的唯一 ID
let currentMessages = []; // 當前對話的訊息陣列 [{sender: 'bot', content: '...'}, {sender: 'user', content: '...'}]


// --- 1. API 呼叫 (已修正，符合 Cloud Run API 結構) ---

/**
 * Call the Cloud Run Chat API
 * @param {string} input - User message (使用者當前的輸入)
 * @returns {Promise<object>} - API response object { success: boolean, message: string }
 */
async function agentEngineApiCall(input) {
    
    // 【修正】根據您的 Cloud Run 範例，請求體只需要 session_id 和 message
    const requestBody = {
        // "session_id": currentApiSessionId, // 使用當前對話 ID
        "message": input // 傳遞使用者當前的輸入
    };

    if (currentApiSessionId) {
        // 如果已經有 ID，則傳遞 ID 以維持記憶
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
            // 檢查狀態碼，例如 4xx 或 5xx
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        // print data to console for debugging
        console.log("Cloud Run API 回覆:", data);
        // 假設 API 回覆格式為 { response: string } 或 { message: string }
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
        // 將錯誤往外拋，讓 handleSendMessage 處理
        throw new Error("無法連接 Cloud Run API 或伺服器錯誤。");
    }
}


// --- 2. 訊息處理與打字特效 ---

/**
 * Create and append message element
 * @param {string} content
 * @param {string} sender 
 * @param {string} id - 元素 ID
 * @param {boolean} isPreTyped - 是否已預先輸入內容 (用於載入歷史紀錄)
 * @returns {HTMLElement}
 */
function createMessageElement(content, sender, id = null, isPreTyped = false) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    if (id) messageDiv.id = id;

    if (sender === 'user') {
        messageDiv.classList.add('user-message');
        messageDiv.textContent = content;
        
        // 無論是新訊息還是載入的歷史訊息，都必須記錄使用者訊息到 currentMessages
        // if (!isPreTyped) {
        //     // 只有在處理新輸入時才加入，因為 loadConversation 會在 isPreTyped=true 時自動加入
        //     currentMessages.push({ sender: 'user', content: content }); 
        // }
        currentMessages.push({ sender: 'user', content: content }); 
        
    } else {
        messageDiv.classList.add('bot-message');
        messageDiv.innerHTML = `**Demo Bot:** <span class="typing-target"></span>`;
        
        if (isPreTyped) {
            // Bot 歷史紀錄訊息在這裡紀錄。
            currentMessages.push({ sender: 'bot', content: content });
        }
    }

    chatHistory.appendChild(messageDiv);
    return messageDiv;
}

/**
 * @param {HTMLElement} targetElement - Target element for content
 * @param {string} text - Full message text
 */
function typeMessage(targetElement, text) {
    let index = 0;
    
    // Set timer
    const intervalId = setInterval(() => {
        if (index < text.length) {
            // Append char
            targetElement.textContent += text.charAt(index);
            index++;
            
            // Scroll to bottom
            chatHistory.scrollTop = chatHistory.scrollHeight; 
        } else {
            // Content done, clear timer
            clearInterval(intervalId);
        }
    }, TYPING_SPEED);
}


// --- 3. 歷史紀錄與摘要管理 ---

/**
 * 儲存當前對話紀錄並更新側邊欄，改進摘要生成邏輯
 * @param {string} initialUserInput - 第一條使用者輸入，用於生成摘要
 */
function saveCurrentConversation(initialUserInput) {
    // 檢查是否有訊息（除了初始歡迎訊息）
    if (currentMessages.length > 1) { 
        
        let conversationIndex = conversations.findIndex(c => c.id === currentChatId);
        let summary = initialUserInput; // 預設摘要為完整輸入

        // --- 摘要生成邏輯優化 ---
        
        // 1. 嘗試擷取第一個完整語句 (以中文常見標點符號結尾)
        const sentenceEndMatch = initialUserInput.match(/([^\r\n。？！，]+[。？！，])/);

        if (sentenceEndMatch) {
            summary = sentenceEndMatch[0].trim();
        } 
        
        // 2. 如果擷取的摘要仍然太長，則強制截斷
        const MAX_SUMMARY_LENGTH = 25; 
        if (summary.length > MAX_SUMMARY_LENGTH) {
            summary = summary.substring(0, MAX_SUMMARY_LENGTH) + '...'; 
        }

        // --- 儲存與更新邏輯 ---
        
        // 如果對話不存在或從未被儲存
        if (conversationIndex === -1) {
            
            const newConversation = {
                id: Date.now(), // 使用時間戳作為唯一 ID
                summary: summary,
                apiSessionId: currentApiSessionId,
                // 訊息陣列是 currentMessages 減去初始歡迎訊息
                messages: currentMessages.slice(1) 
            };
            conversations.unshift(newConversation); 
            currentChatId = newConversation.id;
        } else {
            // 如果是對話更新，則更新其內容和摘要
            conversations[conversationIndex].messages = currentMessages.slice(1);
            conversations[conversationIndex].summary = summary;
            conversations[conversationIndex].apiSessionId = currentApiSessionId;
        }

        // 重新渲染側邊欄
        renderHistoryList();
    }
}

/**
 * 渲染側邊欄的歷史對話列表
 */
function renderHistoryList() {
    historyList.innerHTML = ''; // 清空列表
    
    conversations.forEach(conv => {
        const item = document.createElement('div');
        item.classList.add('history-item');
        item.textContent = conv.summary;
        item.dataset.id = conv.id;

        if (conv.id === currentChatId) {
            item.classList.add('active');
        }

        item.addEventListener('click', () => loadConversation(conv.id));
        historyList.appendChild(item);
    });
}

/**
 * 載入特定的歷史對話
 * @param {number} chatId 
 */
function loadConversation(chatId) {
    // 1. 儲存當前對話 (如果它已經開始且不是剛啟動的新對話)
    if (currentMessages.length > 1) {
        // 使用 currentMessages[1].content 作為摘要來源 (第一條使用者訊息)
        saveCurrentConversation(currentMessages[1].content); 
    }

    // 2. 設定新的當前對話
    const targetConversation = conversations.find(c => c.id === chatId);
    if (!targetConversation) return;

    currentChatId = chatId;
    currentMessages = []; // 必須清空現有訊息，讓 createMessageElement 重新建立

    currentApiSessionId = targetConversation.apiSessionId; // 更新當前 API session ID

    // 3. 渲染聊天視窗
    chatHistory.innerHTML = ''; 
    
    // 重新載入初始訊息 (isPreTyped=true)
    const initialMessageDiv = createMessageElement(INITIAL_WELCOME_TEXT, 'bot', 'initial-message', true);
    initialMessageDiv.querySelector('.typing-target').textContent = INITIAL_WELCOME_TEXT;

    // 載入歷史訊息 (isPreTyped=true)
    targetConversation.messages.forEach(msg => {
        if (msg.sender === 'user') {
            // isPreTyped=true 會避免在 createMessageElement 內重複 push
            createMessageElement(msg.content, 'user', null, true); 
        } else { // bot message
            const botMsgDiv = createMessageElement(msg.content, 'bot', null, true);
            botMsgDiv.querySelector('.typing-target').textContent = msg.content;
        }
    });

    // 4. 滾動到最底部
    chatHistory.scrollTop = chatHistory.scrollHeight; 

    // 5. 更新側邊欄活躍狀態
    renderHistoryList();

    userInput.focus();
}

/**
 * 開始一個新對話
 */
function startNewConversation() {
    // 1. 儲存舊對話 (如果它有內容)
    if (currentMessages.length > 1) {
        saveCurrentConversation(currentMessages[1].content); 
    }
    
    // 2. 重設狀態
    currentChatId = null; 
    currentMessages = []; 
    chatHistory.innerHTML = '';

    currentApiSessionId = null;

    // 3. 重新載入初始訊息 (並觸發打字效果)
    initializeChat();

    // 4. 更新側邊欄活躍狀態 
    renderHistoryList();
}


// --- 4. 流程控制 ---

/**
 * Initializes the chat when the page loads or starts a new conversation
 */
function initializeChat() {
    // 創建初始訊息
    const initialMessageDiv = document.createElement('div');
    initialMessageDiv.classList.add('message', 'bot-message');
    initialMessageDiv.id = 'initial-message';
    initialMessageDiv.innerHTML = `**Demo Bot:** <span class="typing-target"></span>`;
    chatHistory.appendChild(initialMessageDiv);

    // 紀錄初始訊息
    currentMessages.push({ sender: 'bot', content: INITIAL_WELCOME_TEXT });

    const typingTarget = initialMessageDiv.querySelector('.typing-target');
    typeMessage(typingTarget, INITIAL_WELCOME_TEXT);

    userInput.focus();
}


/**
 * Handle user message submission
 */
async function handleSendMessage() {
    const input = userInput.value.trim();

    if (input === "") {
        return; 
    }

    // 在發送第一條訊息時，判斷是否為新對話的第一條訊息
    const isFirstUserMessage = currentMessages.length === 1; 
    const firstUserInput = input; 

    // 1. 顯示使用者訊息 (此處 currentMessages 陣列會新增一條訊息)
    createMessageElement(input, 'user');

    // 2. 創建空的 Bot 訊息元素
    const botMessageElement = createMessageElement('', 'bot');
    const typingTarget = botMessageElement.querySelector('.typing-target');

    // 3. 清空輸入並禁用按鈕
    userInput.value = '';
    sendButton.disabled = true;
    userInput.placeholder = "API 處理中..."; 

    try {
        // 4. 呼叫 API
        const response = await agentEngineApiCall(input);
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
        
        // 6. 紀錄 Bot 訊息
        currentMessages.push({ sender: 'bot', content: botResponseText });

        // 7. 如果是第一次使用者訊息，在 API 回覆後儲存為新的對話紀錄
        if (isFirstUserMessage) {
            saveCurrentConversation(firstUserInput);
        }

    } catch (error) {
        // 錯誤處理
        console.error("API failed:", error);
        const errorMsg = "API 呼叫失敗，請檢查網路或 API 狀態。";
        typeMessage(typingTarget, errorMsg);
        currentMessages.push({ sender: 'bot', content: errorMsg });

    } finally {
        // 8. 重新啟用輸入
        // 延遲啟用，確保打字效果有時間完成
        setTimeout(() => {
            sendButton.disabled = false;
            userInput.placeholder = "在這裡輸入您的訊息..."; 
            userInput.focus();
        }, 1200); 
    }
}


// --- 5. 事件監聽 (修正 Enter 鍵) ---

// 事件監聽: 送出按鈕
sendButton.addEventListener('click', handleSendMessage);

// 事件監聽: Enter 鍵
userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && !sendButton.disabled) { 
        handleSendMessage();
    }
});

// 事件監聽: 新對話按鈕
newChatButton.addEventListener('click', startNewConversation);

// 觸發初始化
window.addEventListener('load', initializeChat);
