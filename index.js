const http = require('http');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

console.log("=== 1. بدء تشغيل الكود ===");

const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Sarai Bot is running!');
});
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`=== 2. السيرفر الوهمي اشتغل على بورت ${port} ===`);
});

const genAI = new GoogleGenerativeAI('AIzaSyBLdovLAtqNRZgnWyioe_y3F5S7_vPWzZk');

async function getSheetData() {
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS6zcrERoQIWZ_TMN6ppVRcPwCo6mfvJUtUscvCQhJJVTxFHwrQ7YZz98I3Im6MQeIfaagyGfkqvAd7/pub?output=csv';
    try {
        const res = await axios.get(sheetUrl);
        return res.data;
    } catch (e) {
        console.error("خطأ في سحب ملف الإكسيل:", e.message);
        return 'لا توجد بيانات أسعار حاليا.';
    }
}

async function connectToWhatsApp() {
    console.log("=== 3. جاري تجهيز ملفات الواتساب... ===");
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        console.log("=== 4. تم تجهيز الملفات، جاري الاتصال بسيرفر Meta... ===");

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Sarai Bot', 'Chrome', '1.0.0'] // تعريف البوت عشان واتساب ميقفلش الاتصال
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('=== 5. الكود وصل! اعمل Scan للـ QR ده فوراً ===');
                qrcode.generate(qr, { small: true });
            }
            
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== 401;
                console.log("=== الاتصال قفل، جاري إعادة المحاولة بعد 3 ثواني... ===");
                if (shouldReconnect) {
                    // تأخير 3 ثواني عشان نمنع اللوب السريعة
                    setTimeout(connectToWhatsApp, 3000); 
                }
            } else if (connection === 'open') {
                console.log('🎉🎉 === البوت متصل وجاهز للرد باسم Sarai! === 🎉🎉');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;

            const text = m.message.conversation || m.message.extendedTextMessage?.text;
            const sender = m.key.remoteJid;

            if (text) {
                console.log(`رسالة جديدة من ${sender}: ${text}`);
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
                    console.log("تم إرسال الرد بنجاح.");
                } catch (error) {
                    console.error('مشكلة في الرد من Gemini:', error);
                }
            }
        });
    } catch (err) {
        console.error("=== مشكلة كبيرة في تشغيل الواتساب ===", err);
    }
}

connectToWhatsApp();
