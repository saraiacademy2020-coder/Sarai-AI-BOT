const http = require('http');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

let currentQR = ""; 
let isConnected = false;

const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    if (isConnected) {
        res.end('<h1 style="text-align:center; margin-top:50px; color:green;">سراي متصلة وجاهزة! 🎉</h1>');
    } else if (currentQR) {
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}`;
        res.end(`<div style="text-align: center; margin-top: 50px;"><img src="${qrImageUrl}" /><h2>اعمل سكان للكود</h2></div>`);
    } else {
        res.end('<h1 style="text-align:center; margin-top:50px;">جاري التحميل...</h1>');
    }
});

server.listen(process.env.PORT || 3000);

const genAI = new GoogleGenerativeAI('AIzaSyBLdovLAtqNRZgnWyioe_y3F5S7_vPWzZk');
// التعديل هنا: استخدام الاسم الرسمي للموديل
const model = genAI.getGenerativeModel({ model: "gemini-1.0-pro" }); 

async function getSheetData() {
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS6zcrERoQIWZ_TMN6ppVRcPwCo6mfvJUtUscvCQhJJVTxFHwrQ7YZz98I3Im6MQeIfaagyGfkqvAd7/pub?output=csv';
    try {
        const res = await axios.get(sheetUrl);
        return res.data;
    } catch (e) { return 'بيانات الأسعار غير متاحة حالياً.'; }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Sarai Bot', 'Chrome', '20.0.04']
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) currentQR = qr;
        if (connection === 'open') {
            isConnected = true;
            console.log('=== سراي أونلاين الآن ===');
        }
        if (connection === 'close') {
            isConnected = false;
            setTimeout(connectToWhatsApp, 3000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const text = m.message.conversation || m.message.extendedTextMessage?.text;
        const sender = m.key.remoteJid;

        if (text) {
            console.log(`وصلت رسالة: ${text}`);
            const prices = await getSheetData();
            const prompt = `أنتِ سراي، مساعدة ذكية لـ Sarai Coworking Space. ردي بالمصري وبخفة دم. دي معلومات المكان: ${prices}. العميل بيقول: ${text}`;

            try {
                const result = await model.generateContent(prompt);
                const reply = result.response.text();
                await sock.sendMessage(sender, { text: reply });
                console.log("تم الرد");
            } catch (error) {
                console.error('خطأ في Gemini:', error.message);
            }
        }
    });
}

connectToWhatsApp();
