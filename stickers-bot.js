require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createCanvas } = require('canvas');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Токен из .env
const token = process.env.TOKEN;
if (!token) {
  console.error('Не найден TOKEN в .env');
  process.exit(1);
}

// Создаём бота
const bot = new TelegramBot(token, { polling: true });

// Функция для разбивки текста на строки (максимум 2-3 слова в строке)
function wrapTextToLines(text, maxWordsPerLine = 3) {
  const words = text.split(' ');
  const lines = [];

  // Разбиваем на группы по maxWordsPerLine слов
  for (let i = 0; i < words.length; i += maxWordsPerLine) {
    const line = words.slice(i, i + maxWordsPerLine).join(' ');
    lines.push(line);
  }

  return lines;
}

// Функция для расчета размера текста
function calculateTextDimensions(ctx, textLines, fontSize, lineHeight = 1.2) {
  const lineHeightPx = fontSize * lineHeight;
  const lineWidths = textLines.map(line => ctx.measureText(line).width);
  const maxWidth = Math.max(...lineWidths);
  const totalHeight = lineHeightPx * textLines.length;

  return {
    maxWidth,
    totalHeight,
    lineHeightPx
  };
}

async function generateStickerWebpBuffer(userText) {
  // Настройки текста
  const fontSize = 80;
  const fontFamily = 'Comic Sans MS';
  const padding = 40;
  const lineHeight = 1.3;
  const maxWordsPerLine = 2;

  // Разбиваем текст на строки
  const textLines = wrapTextToLines(userText, maxWordsPerLine);

  // Создаем временный канвас для измерения
  const tempCanvas = createCanvas(800, 512);
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.font = `${fontSize}px ${fontFamily}`;

  // Рассчитываем размеры текста
  const textDimensions = calculateTextDimensions(tempCtx, textLines, fontSize, lineHeight);

  // Фиксируем размеры под стикер: максимум 512х512 (Telegram)
  const width = Math.min(Math.ceil(textDimensions.maxWidth + padding * 2), 800);
  const height = Math.min(Math.ceil(textDimensions.totalHeight + padding * 2), 512);

  // Создаем основной канвас с прозрачностью
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: true });

  // Прозрачный фон
  ctx.clearRect(0, 0, width, height);

  // Настройка шрифта
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = 'black';
  ctx.strokeStyle = 'gray';
  ctx.lineWidth = 1;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';

  // Координаты для начала рисования (по центру)
  const startX = width / 2;
  const startY = (height - textDimensions.totalHeight) / 2;

  // Рисуем каждую строку текста
  textLines.forEach((line, index) => {
    const y = startY + (index * textDimensions.lineHeightPx);
    ctx.strokeText(line, startX, y);
    ctx.fillText(line, startX, y);
  });

  // Получаем PNG-буфер
  const pngBuffer = canvas.toBuffer('image/png');

  // Преобразуем в WebP с прозрачностью
  const webpBuffer = await sharp(pngBuffer)
    .ensureAlpha() // Гарантируем альфа-канал
    .resize({
      width: 800,
      height: 512,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 } // полностью прозрачный фон
    })
    .webp({
      lossless: true,
      nearLossless: true,
      alphaQuality: 100,
      quality: 100
    })
    .toBuffer();

  return webpBuffer;
}

// Обработчик /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const text =
    'Привет! Я генерирую стикер в формате WebP с прозрачным фоном.\n\n' +
    'Отправь любой текст (до 70 символов), и я пришлю тебе изображение с этим текстом.\n';
  bot.sendMessage(chatId, text);
});

// На любое другое сообщение — картинку
bot.on('message', async (msg) => {
  // Чтобы не дублировать на /start (который уже обрабатываем выше)
  if (msg.text && /^\/start/.test(msg.text)) return;

  // Если сообщение не содержит текста (фото, стикер и т.д.)
  if (!msg.text) {
    return bot.sendMessage(msg.chat.id, 'Пожалуйста, отправьте текст для картинки.');
  }

  const chatId = msg.chat.id;
  let userText = msg.text.trim();

 userText = userText.toUpperCase();

  // Проверка длины текста
  if (userText.length > 70) {
    return bot.sendMessage(chatId, 'Текст слишком длинный, максимум 70 символов.');
  }

  // Если текст пустой
  if (userText === '') {
    userText = 'Здесь мог быть ваш текст';
  }

  try {
    // Создаем временную папку, если её нет
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Генерируем WebP буфер
    console.log(`Генерация изображения для текста: "${userText}"`);
    const buffer = await generateStickerWebpBuffer(userText);

    // Создаем уникальное имя файла
    const timestamp = Date.now();
    const fileName = `sticker_${timestamp}.webp`;
    const filePath = path.join(tempDir, fileName);

    // Сохраняем WebP файл
    fs.writeFileSync(filePath, buffer);
    console.log(`Файл сохранен: ${filePath}, размер: ${buffer.length} байт`);

    // Отправляем как документ (сохраняет прозрачность)
    await bot.sendDocument(chatId, filePath, {
      caption: `Текст: ${userText}`,
      filename: 'sticker.webp'
    });

    // Удаляем временный файл после отправки
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`Временный файл удален: ${filePath}`);
        }
      } catch (unlinkErr) {
        console.error('Ошибка при удалении файла:', unlinkErr);
      }
    }, 10000); // Удаляем через 10 секунд

  } catch (err) {
    console.error('Ошибка при создании изображения:', err);
    await bot.sendMessage(chatId, 'Не удалось создать изображение. Попробуйте ещё раз с другим текстом.');
  }
});

// Обработчик ошибок бота
bot.on('polling_error', (error) => {
  console.error('Ошибка polling:', error);
});

bot.on('webhook_error', (error) => {
  console.error('Ошибка webhook:', error);
});

console.log('Бот запущен...');
console.log('Ожидание сообщений...');
