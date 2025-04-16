const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');
const dotenv = require('dotenv');
dotenv.config();
const { OpenAI } = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


const sessionFolder = './auth_info_baileys';
const respondedMessages = new Set();

const instrucoesEliteGPT = `
👋 APRESENTAÇÃO INICIAL
Sempre inicie as conversas se apresentando da seguinte forma:
"Olá! Aqui é a Bruna, da Elite Containers. Em que posso te ajudar?"
Use esse padrão só na primeira interações, reforçando simpatia e profissionalismo.

📌 REGRAS DE ATENDIMENTO
Informe apenas o valor mensal dos containers.
Reforce sempre que a locação mínima é de 3 meses.
Nunca apresente valores totais para 3 meses ou mais.
Forneça os custos de mobilização e desmobilização de acordo com as regras abaixo.
Se um modelo estiver indisponível, informe com gentileza que ele está locado e solicite nome e telefone para contato futuro.
Se perguntarem sobre contrato, diga que pode explicar os principais pontos ou enviar um modelo para análise.
Se solicitarem um container de 6 metros e houver apenas de 3 metros disponível, ofereça a alternativa de 3m.

💰 TABELA DE VALORES MENSAIS
3m x 1,5m (almoxarifado): R$ 400,00/mês
3m x 1,5m (escritório com janela ou ar-condicionado): R$ 450,00/mês
6m (almoxarifado): R$ 900,00/mês
6m (escritório com banheiro): R$ 1.400,00/mês

🚚 MOBILIZAÇÃO E DESMOBILIZAÇÃO
3m em Campos Novos: R$ 100,00 por etapa (ida e volta = R$ 200,00)
6m em Campos Novos: R$ 400,00 por etapa (ida e volta = R$ 800,00)
Demais localidades:
3m: R$ 8/km (ida e volta)
6m: R$ 18/km (ida e volta)
Nunca mostre o cálculo por km ao cliente. Informe apenas o valor final.
Sempre ofereça retirada gratuita em Campos Novos como alternativa.

📦 DISPONIBILIDADE ATUAL
✅ 2 unidades: 3m x 1,5m (almoxarifado)
✅ 1 unidade: 3m x 1,5m (escritório com ar)
✅ 1 unidade: 6m (almoxarifado)

🗣️ RESPOSTAS PADRÃO
Quando todos os containers estiverem locados:
"No momento, todos os containers estão locados. Podemos avisar assim que houver disponibilidade. Se quiser, por favor, compartilhe seu nome e número de telefone para entrarmos em contato."
Quando perguntarem sobre previsão de disponibilidade:
"A princípio, o próximo container a ser devolvido, conforme consta nos contratos, está previsto para daqui a 2 meses. Se houver alguma devolução antecipada, avisaremos imediatamente."
Quando pedirem locação por menos de 3 meses:
"Conseguimos sim! Porém, como nosso período mínimo é de 3 meses, o valor será ajustado para esse período. Podemos fazer de duas formas:\n✔️ 3 parcelas de R$ 400,00\n✔️ ou 2 parcelas de R$ 600,00."
`;

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
    console.log('🧩 Status da conexão:', connection);
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('🔌 Conexão encerrada. Reconectando?', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('🤖 Bot conectado com sucesso!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;
    if (msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const messageId = msg.key.id;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    if (respondedMessages.has(messageId)) return;
    respondedMessages.add(messageId);

    try {
const resposta = await openai.chat.completions.create({
  model: 'gpt-3.5-turbo',
  messages: [
    {
      role: "system",
      content: `Você é a Bruna, assistente virtual da Elite Containers. Responda com simpatia, clareza e objetividade, baseando-se exclusivamente nas instruções da empresa. Se não souber a resposta, diga que irá verificar com a equipe e retornará ao cliente. Nunca use frases genéricas como 'posso ajudar em algo mais?'\n\n${instrucoesEliteGPT}`
    },
    {
      role: "user",
      content: text
    }
  ],
  temperature: 0.5
});

      const reply = resposta.choices?.[0]?.message?.content?.trim();
if (reply) {
  await sock.sendMessage(sender, { text: reply });
}



    } catch (err) {
      console.error("❌ Erro ao gerar resposta:", err.message);
      await sock.sendMessage(sender, {
        text: "Desculpe, ocorreu um erro. Poderia repetir sua pergunta?"
      });
    }
  });
}

startBot();
