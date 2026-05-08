const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Bot is running!');
});
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

// حط مفتاح Gemini هنا
const genAI = new GoogleGenerativeAI('AIzaSyBLdovLAtqNRZgnWyioe_y3F5S7_vPWzZk');

// دالة لسحب البيانات من Google Sheets
async function getSheetData() {
    // حط لينك الشيت هنا (لازم يكون Published as CSV)
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS6zcrERoQIWZ_TMN6ppVRcPwCo6mfvJUtUscvCQhJJVTxFHwrQ7YZz98I3Im6MQeIfaagyGfkqvAd7/pub?output=csv';
    try {
        const res = await axios.get(sheetUrl);
        return res.data;
    } catch (e) {
        return 'لا توجد بيانات أسعار حاليا.';
    }
}

async function connectToWhatsApp() {
    // حفظ الـ Session عشان ما يطلبش QR كل شوية
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // هنطبعه بنفسنا
        logger: pino({ level: 'silent' })
    });

    // طباعة الـ QR Code
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('اعمل Scan للـ QR Code ده:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== 401;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('Bot is online!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // استقبال الرسايل والرد
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const text = m.message.conversation || m.message.extendedTextMessage?.text;
        const sender = m.key.remoteJid;

        if (text) {
            const prices = await getSheetData();
            
            const prompt = `
            أنت مساعدة ذكية (AI) اسمك 'Sarai'. وظيفتك الرد على عملاء Sarai Coworking Space.
            وضحي للعملاء إنك ذكاء اصطناعي بشكل طبيعي ومختصر.
            اتكلمي بلهجة مصرية عامية، واضحة ومباشرة.
            دي تفاصيل الأسعار والخدمات من الإدارة:
            ${prices}
            
            رسالة العميل: ${text}
            `;

            try {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(prompt);
                const reply = result.response.text();

                await sock.sendMessage(sender, { text: reply });
            } catch (error) {
                console.error('Error generating AI response:', error);
            }
        }
    });
}

connectToWhatsApp();
