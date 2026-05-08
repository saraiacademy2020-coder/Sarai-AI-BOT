const http = require('http');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

let currentQR = ""; 
let isConnected = false;

// السيرفر هيعرض صفحة ويب فيها صورة الـ QR بدل الـ Logs
const server = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    if (isConnected) {
        res.end('<h1 style="text-align:center; margin-top:50px; color:green;">البوت متصل وشغال تمام! 🎉</h1>');
    } else if (currentQR) {
        // بنحول كود الـ QR لصورة واضحة عن طريق API خارجي
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}`;
        res.end(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h2>اعمل Scan للكود ده من موبايلك</h2>
                <img src="${qrImageUrl}" alt="QR Code" style="border: 2px solid #ccc; padding: 10px; border-radius: 10px;" />
                <p style="color: gray;">(لو الكود ملقطش، اعمل ريفرش للصفحة عشان تاخد الكود الجديد)</p>
            </div>
        `);
    } else {
        res.end('<h1 style="text-align:center; margin-top:50px;">جاري تجهيز الكود... اعمل ريفرش كمان ثواني</h1>');
    }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`السيرفر شغال على بورت ${port}`);
});

const genAI = new GoogleGenerativeAI('AIzaSyBLdovLAtqNRZgnWyioe_y3F5S7_vPWzZk');

async function getSheetData() {
    const sheetUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS6zcrERoQIWZ_TMN6ppVRcPwCo6mfvJUtUscvCQhJJVTxFHwrQ7YZz98I3Im6MQeIfaagyGfkqvAd7/pub?output=csv';
    try {
        const res = await axios.get(sheetUrl);
        return res.data;
    } catch (e) {
        return 'لا توجد بيانات أسعار حاليا.';
    }
}

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false, // قفلنا الـ QR بتاع الـ Logs
            logger: pino({ level: 'silent' }),
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                currentQR = qr; // حفظنا الكود عشان يظهر في الموقع
                console.log('=== افتح لينك Render دلوقتي عشان تعمل Scan ===');
            }
            
            if (connection === 'close') {
                isConnected = false;
                setTimeout(connectToWhatsApp, 3000); 
            } else if (connection === 'open') {
                isConnected = true;
                currentQR = "";
                console.log('=== البوت متصل وجاهز للرد باسم Sarai! ===');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            if (!m.message || m.key.fromMe) return;

            const text = m.message.conversation || m.message.extendedTextMessage?.text;
            const sender = m.key.remoteJid;

            if (text) {
                const prices = await getSheetData();
                const prompt = `
                أنت مساعدة ذكية (AI) اسمك 'Sarai'. وظيفتك الرد على عملاء Sarai Coworking Space.
                وضحي للعملاء إنك ذكاء اصطناعي.
                اتكلمي بلهجة مصرية عامية، واضحة ومباشرة.
                دي تفاصيل الأسعار:
                ${prices}
                رسالة العميل: ${text}
                `;

                try {
                    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                    const result = await model.generateContent(prompt);
                    const reply = result.response.text();
                    await sock.sendMessage(sender, { text: reply });
                } catch (error) {
                    console.error('مشكلة في الرد:', error);
                }
            }
        });
    } catch (err) {
        console.error("مشكلة:", err);
    }
}

connectToWhatsApp();
