require('dotenv').config(); // Carrega variáveis do .env

const fs = require('fs');
const AdmZip = require('adm-zip');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
const assistantId = process.env.OPENAI_ASSISTANT_ID;

const sessionFolder = './auth_info_baileys';
const zipPath = './auth_info_baileys.zip';

const respondedMessages = new Set();
const userThreads = new Map();

async function extractZipIfExists() {
  if (fs.existsSync(zipPath)) {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(sessionFolder, true);
    console.log('✅ Sessão descompactada com sucesso.');
  } else {
    console.log('⚠️ Nenhum arquivo de sessão ZIP encontrado. Será necessário escanear o QR.');
  }
}

async function startBot() {
  console.log('🔄 Iniciando o bot...');
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    logger: P({ level: 'info' })
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('🤖 Bot conectado com sucesso!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const messageId = msg.key.id;
    let text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    text = text.trim();
    if (!text) return;

    if (respondedMessages.has(messageId)) return;
    respondedMessages.add(messageId);

    try {
      let threadId;
      if (userThreads.has(sender)) {
        threadId = userThreads.get(sender);
      } else {
        const thread = await openai.beta.threads.create();
        threadId = thread.id;
        userThreads.set(sender, threadId);
      }

      let lastRun;
      try {
        const runsList = await openai.beta.threads.runs.list(threadId);
        lastRun = runsList.data.find(run =>
          run.status !== 'completed' &&
          run.status !== 'failed' &&
          run.status !== 'cancelled'
        );
      } catch (e) {
        lastRun = null;
      }

      if (lastRun) {
        let statusCheck;
        while (true) {
          statusCheck = await openai.beta.threads.runs.retrieve(threadId, lastRun.id);
          if (['completed', 'failed', 'cancelled'].includes(statusCheck.status)) break;
          await new Promise(res => setTimeout(res, 1000));
        }
      }

      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: text
      });

      const run = await openai.beta.threads.runs.create(threadId, {
        assistant_id: assistantId
      });

      let result;
      while (true) {
        result = await openai.beta.threads.runs.retrieve(threadId, run.id);
        if (result.status === "completed") break;
        await new Promise(res => setTimeout(res, 1000));
      }

      const messages = await openai.beta.threads.messages.list(threadId);
      const reply = messages.data[0].content[0].text.value;

      if (reply) {
        await sock.sendMessage(sender, { text: reply });
      }

    } catch (err) {
      console.error("❌ Erro:", err.message);
      await sock.sendMessage(sender, {
        text: "Desculpe, ocorreu um erro. Pode repetir sua pergunta?"
      });
    }
  });
}

// ⬇️ Inicia com a descompactação antes do bot
extractZipIfExists().then(startBot);
