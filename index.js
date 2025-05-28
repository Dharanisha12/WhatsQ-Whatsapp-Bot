process.env.PUPPETEER_EXECUTABLE_PATH = require('puppeteer').executablePath();

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const mysql = require('mysql2/promise');
const QR = require('qrcode');


const db = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'dhara1210',
  database: 'whatsq'
});

const client = new Client({
  authStrategy: new LocalAuth()
});

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('📲 Scan QR Code with your WhatsApp');
});

client.on('ready', () => {
  console.log('✅ WhatsQ Bot is Ready!');
});

const userState = {};

client.on('message', async msg => {
  const chatId = msg.from;
  const text = msg.body.trim().toLowerCase();
  const today = new Date().toISOString().split('T')[0];

  if (!userState[chatId]) userState[chatId] = { step: null };
  const state = userState[chatId];

  if (['hi', 'hello', 'whatsq'].includes(text)) {
    state.step = null;
    client.sendMessage(chatId,
      '👋 Welcome to *WhatsQ*\nChoose an option:\n1️⃣ Book Token\n2️⃣ Check Queue Status\n3️⃣ Cancel Token');
    return;
  }

  if (text === '1' && state.step === null) {
    state.step = 'await_name';
    client.sendMessage(chatId, '📝 Enter your *full name* to book your token:');
    return;
  }

  if (state.step === 'await_name') {
    const fullName = msg.body.trim();

    if (!/^[a-zA-Z\s]+$/.test(fullName)) {
      client.sendMessage(chatId, '❌ Invalid name. Please enter only alphabet letters.');
      return;
    }

    state.full_name = fullName;
    state.step = 'await_phone';
    client.sendMessage(chatId, '📱 Now enter your *mobile number* to proceed:');
    return;
  }

  if (state.step === 'await_phone') {
    const full_name = state.full_name;
    const phone = msg.body.trim();

    if (!/^\d{10}$/.test(phone)) {
      client.sendMessage(chatId, '❌ Invalid mobile number. Please enter a valid 10-digit number.');
      return;
    }



    const [rows] = await db.execute(
      "SELECT token_number FROM tokens WHERE DATE(created_at) = ? AND status != 'cancelled' ORDER BY token_number DESC LIMIT 1",
      [today]
    );

    let token_number, estimatedTime;

    if (rows.length > 0) {
      token_number = rows[0].token_number + 1;

      const [lastTokenRow] = await db.execute(
        "SELECT created_at FROM tokens WHERE token_number = ? AND DATE(created_at) = ?",
        [rows[0].token_number, today]
      );

      let lastCreated = new Date(lastTokenRow[0].created_at);
      let baseTime = new Date(lastCreated.getTime() + 15 * 60000);
      estimatedTime = new Date(Math.max(baseTime.getTime(), Date.now()));
    } else {
      token_number = 1;
      estimatedTime = new Date(Date.now());
    }

    await db.execute(
      "INSERT INTO tokens (full_name, phone, token_number, status, created_at) VALUES (?, ?, ?, ?, NOW())",
      [full_name, phone, token_number, 'waiting']
    );

    const readableTime = estimatedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const qrData = {
      token: token_number,
      name: full_name,
      phone: phone,
      time: readableTime,
      status: 'waiting',
      created_at: new Date().toISOString()
    };
    const qrPath = `./qr/token_${token_number}.png`;
    await QR.toFile(qrPath, JSON.stringify(qrData));

    client.sendMessage(chatId, `✅ *Token Booked!*\n🧑 Name: ${full_name}\n🔢 Token No: ${token_number}\n⏳ Estimated Time: ${readableTime}`);
    const media = MessageMedia.fromFilePath(qrPath);
    client.sendMessage(chatId, media);
    client.sendMessage(chatId, '🙏 Thank you for using *WhatsQ*!');

    state.step = null;
    return;
  }

  if (text === '2' && state.step !== 'await_cancel_token_number') {
    const [rows] = await db.execute(
      "SELECT * FROM tokens WHERE DATE(created_at) = ?", [today]
    );

    const total = rows.length;
    const waiting = rows.filter(r => r.status === 'waiting').length;
    const inConsult = rows.filter(r => r.status === 'in-consultancy').length;
    const completed = rows.filter(r => r.status === 'completed').length;
    const cancelled = rows.filter(r => r.status === 'cancelled').length;

    client.sendMessage(chatId,
      `📊 *Today's Queue Status:*\n🔢 Total: ${total}\n⌛ Waiting: ${waiting}\n🩺 In Consultation: ${inConsult}\n✅ Completed: ${completed}\n❌ Cancelled: ${cancelled}`);
    return;
  }

  if (text === '3' && state.step === null) {
    state.step = 'await_cancel_name';
    client.sendMessage(chatId, '🔁 Please enter your *name* to cancel your token:');
    return;
  }

  if (state.step === 'await_cancel_name') {
    const inputName = msg.body.trim();
    const normalizedInputName = inputName.toLowerCase();

    const [rows] = await db.execute(
      "SELECT * FROM tokens WHERE LOWER(full_name) = ? AND DATE(created_at) = ? AND status != 'cancelled'",
      [normalizedInputName, today]
    );

    if (rows.length === 0) {
      client.sendMessage(chatId, '❌ Invalid name. No active token found for today. Please check and try again.');
      return;
    }

    state.cancelName = inputName;
    state.step = 'await_cancel_token_number';
    client.sendMessage(chatId, `🧑 Name matched.\n🔢 Now, please enter your *token number* to proceed with cancellation:`);
    return;
  }

  if (state.step === 'await_cancel_token_number') {
    const tokenNum = parseInt(msg.body.trim(), 10);

    if (isNaN(tokenNum)) {
      client.sendMessage(chatId, '❌ Invalid token number. Please enter a valid number.');
      return;
    }

    const [rows] = await db.execute(
      "SELECT * FROM tokens WHERE LOWER(full_name) = ? AND token_number = ? AND DATE(created_at) = ? AND status != 'cancelled'",
      [state.cancelName.toLowerCase(), tokenNum, today]
    );

    if (rows.length === 0) {
      client.sendMessage(chatId, '❌ Invalid token number for the given name today. Please double-check and try again.');
      client.sendMessage(chatId, '📝 Please enter the *correct token number* to proceed with cancellation.');
      return;
    }

    await db.execute(
      "UPDATE tokens SET status = 'cancelled' WHERE LOWER(full_name) = ? AND token_number = ? AND DATE(created_at) = ?",
      [state.cancelName.toLowerCase(), tokenNum, today]
    );

    client.sendMessage(chatId, `❌ *Token Cancelled Successfully!*\n🧑 Name: ${state.cancelName}\n🔢 Token No: ${tokenNum}`);
    client.sendMessage(chatId, '🙏 Thank you! Your token has been updated as *Cancelled*.');

    state.step = null;
    return;
  }

});

client.initialize();
