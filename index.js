const { GoogleGenerativeAI } = require('@google/generative-ai');
const { makeWASocket, DisconnectReason, useMultiFileAuthState } = require('baileys');
const mysql = require('mysql2/promise');

// Get Gemini AI API Key here: https://aistudio.google.com/apikey
const googleAi = new GoogleGenerativeAI('CHANGE_THIS_TO_YOUR_GEMINI_API_KEY');
const geminiAi = googleAi.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Database connection pool configuration
const pool = mysql.createPool({
  host: "localhost", // Change this to your own database host
  user: "root", // Change this to your own database user
  password: "", // Change this to your own database password
  database: "sample_data" // Change this to your own database name
});

/**
 * Executes an SQL query against the database.
 * @param {string} query - The SQL query to execute.
 * @returns {Promise<Array<any>|null>} - The results of the query or null if an error occurred.
 */
async function executeSQLQuery(query) {
  console.log(`Executing SQL query: ${query}`);
  const connection = await pool.getConnection(); // Get a connection from the pool
  try {
    const [results] = await connection.query(query); // Execute the query
    return results; // Return the results
  } catch (error) {
    console.error(`Error executing SQL query: ${error}`); // Log any errors
    return null;
  } finally {
    connection.release(); // Release the connection back to the pool
  }
}

/**
 * Generates an AI response based on a given prompt.
 * @param {string} prompt - The prompt to send to the AI.
 * @returns {Promise<string>} - The AI's response.
 */
async function generateAiResponse(prompt) {
  const result = await geminiAi.generateContent(prompt); // Generate content using Gemini AI
  const response = await result.response; // Get the response object

  return response.text().trim(); // Return the text response, trimming any whitespace
}

/**
 * Generates an SQL query based on a user's message using AI.
 * @param {string} userMessage - The user's message.
 * @returns {Promise<string>} - The generated SQL query.
 */
async function generateSQLQuery(userMessage) {
  const systemPrompt = "You are an expert database assistant. \
     Convert the following user request into an optimized SQL query in MySQL using this database schema: \
     The output must in plain text, don't use code wrapper or markdown formatting. \
     CREATE TABLE orders ( \
       `id` INT AUTO_INCREMENT PRIMARY KEY, \
       `name` VARCHAR(50), \
       `product_name` VARCHAR(255), \
       `price` DECIMAL(10,2), \
       `order_date` DATE, \
       `order_status` VARCHAR(100), \
       INDEX `idx_product_name` (`product_name`), \
       INDEX `idx_order_status` (`order_status`) \
     );";

  const prompt = `${systemPrompt}\n\nUser request: ${userMessage}`;

  return await generateAiResponse(prompt); // Use AI to generate the SQL query
}

/**
 * Generates a user-friendly response based on the user's message and the SQL query results.
 * @param {string} userMessage - The user's original message.
 * @param {Array<any>} queryResults - The results of the SQL query.
 * @returns {Promise<string>} - The generated user response.
 */
async function generateUserResponse(userMessage, queryResults) {
  const systemPrompt = "You are a helpful assistant. \
        Based on the data provided, compose a friendly and concise message summarizing \
        the information for the user. Use clear language and format the message with numbers \
        or bullets for readability. Don't use markdown formatting, use WhatsApp format instead. \
        Do not include any technical jargon. Use the same language as the user used.";

  const prompt = `${systemPrompt}\n\nOriginal request: ${userMessage}\n\nData: ${JSON.stringify(queryResults)}`;

  return generateAiResponse(prompt); // Use AI to generate the user response
}

/**
 * Establishes a connection to WhatsApp and sets up event listeners.
 */
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('whatsapp_sessions'); // Load authentication state

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true // Print QR code to terminal for initial login
  });

  // Handle connection updates
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'connecting') {
      console.log('WhatsApp is connecting...');
    }

    if (connection === 'open') {
      console.log('WhatsApp connected! ChatBot is ready to use...');
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        connectToWhatsApp(); // Reconnect if not logged out
      }
    }
  });

  sock.ev.on('creds.update', saveCreds); // Save authentication credentials on update

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      if (!message.message || message.key.fromMe) continue; // Ignore if no message or message is from self

      const userMessage = message.message.conversation || message.message.extendedTextMessage?.text || ''; // Extract user message

      if (!userMessage) continue; // Ignore empty messages

      try {
        const sqlQuery = await generateSQLQuery(userMessage); // Generate SQL query from user message
        const queryResults = await executeSQLQuery(sqlQuery); // Execute the SQL query
        const formattedResponse = await generateUserResponse(userMessage, queryResults); // Generate user response from query results
        await sock.sendMessage(message.key.remoteJid, { text: formattedResponse }); // Send the response to the user
      } catch (error) {
        await sock.sendMessage(message.key.remoteJid, { text: `Error: ${error}` }); // Send an error message if something goes wrong
      }
    }
  });
}

connectToWhatsApp().catch(err => console.log('Unexpected error:', err)); // Start the WhatsApp connection
