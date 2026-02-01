require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const db = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const ADMIN_CARD = process.env.ADMIN_CARD;

// Initialize DB
db.initDb();

// --- Configuration ---
const BAD_WORDS = ['jalap', 'qanjiq', 'itvachcha', 'oneni', 'skat', 'shalpang', 'sharmanda', 'mol', 'qo\'y', 'iflos']; // Add more as needed
const REVEAL_COST = 50; // Cost in DICO to reveal profile

// --- Keyboards ---
const mainKeyboard = Markup.keyboard([
    ['🔎 Qidiruv'],
    ['💰 DICO sotib olish', '👤 Profil'],
    ['🏆 Reyting', '📜 Qoidalar']
]).resize();

const searchKeyboard = Markup.keyboard([
    ['❌ Qidiruvni to\'xtatish']
]).resize();

const chatKeyboard = Markup.keyboard([
    ['❌ Suhbatni yakunlash', '👤 Profilini ko\'rish']
]).resize();

const genderKeyboard = Markup.keyboard([
    ['Male 👱‍♂️', 'Female 👱‍♀️']
]).oneTime().resize();

// --- Helper Functions ---
function containsBadWords(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return BAD_WORDS.some(word => lower.includes(word));
}

function containsLinks(text) {
    if (!text) return false;
    // Patterns for URLs and Telegram usernames/links
    const linkPattern = /(https?:\/\/[^\s]+|www\.[^\s]+|t\.me\/[^\s]+|@[a-zA-Z0-9_]{5,})/gi;
    return linkPattern.test(text);
}

// --- Middlewares ---
bot.use(async (ctx, next) => {
    if (ctx.from) {
        if (db.isBanned(ctx.from.id)) {
            return ctx.reply('Siz qoidabuzarlik uchun 24 soatga bloklangansiz! 🚫');
        }
    }
    return next();
});

// --- Commands ---
bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    db.createUser(id, username || 'No username', first_name);

    const user = db.getUser(id);
    if (!user.phone) {
        return ctx.reply(
            `Xush kelibsiz! Botdan foydalanish uchun telefon raqamingizni yuboring:`,
            Markup.keyboard([
                [Markup.button.contactRequest('📱 Kontaktni ulashish')]
            ]).oneTime().resize()
        );
    }

    if (!user.gender) {
        return ctx.reply(`Iltimos, jinsingizni tanlang:`, genderKeyboard);
    }

    ctx.reply(`Xush kelibsiz, ${first_name}! Chatni boshlash uchun "🔎 Qidiruv" tugmasini bosing.`, mainKeyboard);
});

// --- Onboarding Handlers ---
bot.on('contact', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    if (!user.phone) {
        db.updatePhone(ctx.from.id, ctx.message.contact.phone_number);
        ctx.reply('Raqam qabul qilindi! Endi jinsingizni tanlang:', genderKeyboard);
    }
});

bot.hears(['Male 👱‍♂️', 'Female 👱‍♀️'], async (ctx) => {
    const gender = ctx.message.text.includes('Male') ? 'male' : 'female';
    db.updateGender(ctx.from.id, gender);
    ctx.reply('Hammasi tayyor! Marhamat, chatni boshlang.', mainKeyboard);
});

// --- Main Features ---
bot.hears('🔎 Qidiruv', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    if (!user.gender) return ctx.reply('Avval jinsingizni tanlang /start');

    if (user.status === 'chatting') return ctx.reply('Siz allaqachon suhbatdasiz!');
    if (user.status === 'searching') return ctx.reply('Siz allaqachon qidiryapsiz...');

    db.updateStatus(ctx.from.id, 'searching');
    ctx.reply('Sherik qidirilmoqda... Kuting.', searchKeyboard);

    const partner = db.findPartner(ctx.from.id, user.gender);

    if (partner) {
        db.updateStatus(ctx.from.id, 'chatting', partner.id);
        db.updateStatus(partner.id, 'chatting', ctx.from.id);

        const msg = 'Sherik topildi! Suhbatni boshlashingiz mumkin.\n\n⚠️ Link va reklamalar taqiqlanadi! Har biri uchun XP beriladi.';
        ctx.reply(msg, chatKeyboard);
        bot.telegram.sendMessage(partner.id, msg, chatKeyboard);
    }
});

bot.hears('❌ Qidiruvni to\'xtatish', (ctx) => {
    const user = db.getUser(ctx.from.id);
    if (user.status === 'searching') {
        db.updateStatus(ctx.from.id, 'idle');
        ctx.reply('Qidiruv to\'xtatildi.', mainKeyboard);
    }
});

bot.hears('❌ Suhbatni yakunlash', (ctx) => {
    const user = db.getUser(ctx.from.id);
    if (user.status === 'chatting') {
        const partnerId = user.partner_id;
        db.updateStatus(ctx.from.id, 'idle');
        db.updateStatus(partnerId, 'idle');
        ctx.reply('Suhbat yakunlandi.', mainKeyboard);
        bot.telegram.sendMessage(partnerId, 'Sherik suhbatni yakunladi.', mainKeyboard);
    }
});

// --- Profile Reveal Logic ---
bot.hears('👤 Profilini ko\'rish', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    if (user.status !== 'chatting') return ctx.reply('Siz suhbatda emassiz.');

    if (user.dico_balance < REVEAL_COST) {
        return ctx.reply(`Sizning balansingizda DICO yetarli emas! \nProfilni ko'rish ${REVEAL_COST} DICO turadi.\nSizda: ${user.dico_balance} DICO.`);
    }

    const partner = db.getUser(user.partner_id);
    db.subtractDico(ctx.from.id, REVEAL_COST);

    ctx.reply(
        `Sherigingiz haqida ma'lumot:\n\n` +
        `👤 Ismi: ${partner.full_name}\n` +
        `🆔 ID: ${partner.id}\n` +
        `🔗 Username: @${partner.username}\n` +
        `📱 Tel: ${partner.phone}\n\n` +
        `Balansingizdan ${REVEAL_COST} DICO yechildi.`
    );
});

// --- Payment Handlers ---
bot.hears('💰 DICO sotib olish', (ctx) => {
    ctx.reply(
        `💰 DICO tariflari:\n100 DICO = 5,000 so'm\n200 DICO = 10,000 so'm\n500 DICO = 25,000 so'm\n\n` +
        `To'lov uchun karta: \`${ADMIN_CARD}\`\n\n` +
        `To'lovni amalga oshirgach, chekni (screenshot) shu yerga yuboring.`,
        { parse_mode: 'Markdown' }
    );
});

bot.on('photo', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    if (user.status === 'chatting') return; // Don't handle photos as payments in chat

    const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    ctx.reply('Xabar adminga yuborildi. Tasdiqlashni kuting...');

    // Notify Admin
    bot.telegram.sendPhoto(ADMIN_ID, photo, {
        caption: `💰 Yangi to'lov!\nFoydalanuvchi: ${ctx.from.first_name} (${ctx.from.id})\n\nQancha DICO qo'shilsin? (Javob sifatida yozing)`,
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ 100 DICO', callback_data: `pay_${ctx.from.id}_100` }],
                [{ text: '✅ 200 DICO', callback_data: `pay_${ctx.from.id}_200` }],
                [{ text: '✅ 500 DICO', callback_data: `pay_${ctx.from.id}_500` }],
                [{ text: '❌ Rad etish', callback_data: `reject_${ctx.from.id}` }]
            ]
        }
    });
});

bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const [action, userId, amount] = data.split('_');

    if (action === 'pay') {
        db.addDico(userId, parseInt(amount));
        bot.telegram.sendMessage(userId, `Tabriklaymiz! Sizga ${amount} DICO qo'shildi. ✅`);
        ctx.answerCbQuery(`${amount} DICO qo'shildi.`);
        ctx.editMessageCaption(`Tasdiqlandi: ${amount} DICO qo'shildi.`);
    } else if (action === 'reject') {
        bot.telegram.sendMessage(userId, `To'lovingiz rad etildi. ❌`);
        ctx.answerCbQuery(`Rad etildi.`);
        ctx.editMessageCaption(`To'lov rad etildi.`);
    }
});

// --- General Stats & Info ---
bot.hears('📜 Qoidalar', (ctx) => {
    ctx.reply(
        `📜 *Botdan foydalanish qoidalari va yo'riqnoma:*\n\n` +
        `1. *Telefon raqam:* Botdan foydalanish uchun kontaktni ulashish shart. Bu xavfsizlik uchun.\n` +
        `2. *Qidiruv:* "🔎 Qidiruv" tugmasini bosing va bot sizga mos sherik topadi.\n` +
        `3. *So'kinish:* Haqoratli so'zlar uchun 3 ta ogohlantirish beriladi, so'ngra 24 soatga bloklanasiz.\n` +
        `4. *Linklar:* Reklama va username yuborish qat'iyan taqiqlanadi.\n` +
        `5. *DICO:* Bu bot valyutasi. Profilni ochish yoki maxsus imkoniyatlar uchun kerak.\n` +
        `6. *To'lov:* 100 DICO = 5,000 so'm. Chekni botga rasm ko'rinishida yuboring.\n\n` +
        `🆘 Muammo bo'lsa, adminga murojaat qiling: @secureXXX`,
        { parse_mode: 'Markdown' }
    );
});

bot.hears('👤 Profil', (ctx) => {
    const user = db.getUser(ctx.from.id);
    ctx.reply(
        `👤 *Profilingiz:*\n\n` +
        `🆔 ID: \`${user.id}\`\n` +
        `⭐ XP: ${user.xp}\n` +
        `💰 DICO: ${user.dico_balance}\n` +
        `🚻 Jins: ${user.gender === 'male' ? 'Erkak' : 'Ayol'}\n` +
        `📱 Tel: ${user.phone}\n` +
        `⚠️ Ogohlantirishlar: ${user.warnings}/3\n\n` +
        `Yordam uchun: @secureXXX`,
        { parse_mode: 'Markdown' }
    );
});

bot.hears('🏆 Reyting', (ctx) => {
    const top = db.getTopUsers(10);
    let txt = '🏆 Reyting (XP boyicha):\n\n';
    top.forEach((u, i) => txt += `${i + 1}. ${u.full_name} - ${u.xp} XP\n`);
    ctx.reply(txt);
});

// --- Chat Handling & Filtering ---
bot.on('message', async (ctx) => {
    const user = db.getUser(ctx.from.id);
    if (!user) return;

    if (user.status === 'chatting' && user.partner_id) {
        const text = ctx.message.text || ctx.message.caption || '';

        // 1. Link filtering
        if (containsLinks(text)) {
            await ctx.deleteMessage().catch(() => { });
            return ctx.reply('⚠️ Username va Linklar yuborish taqiqlangan! Xabaringiz o\'chirib tashlandi.');
        }

        // 2. Bad words filtering
        if (containsBadWords(text)) {
            const isBanned = db.addWarning(ctx.from.id);
            if (isBanned) {
                db.updateStatus(ctx.from.id, 'idle');
                db.updateStatus(user.partner_id, 'idle');
                bot.telegram.sendMessage(user.partner_id, 'Sherik qoidani buzgani uchun bloklandi.');
                return ctx.reply('Siz 3 marta so\'kinganingiz uchun 24 soatga bloklandingiz! 🚫');
            } else {
                const u = db.getUser(ctx.from.id);
                return ctx.reply(`⚠️ So'kinish taqiqlanadi! Ogohlantirish: ${u.warnings}/3`);
            }
        }

        // 3. XP reward
        db.addXP(ctx.from.id, 1);

        // 4. Forward message
        try {
            await ctx.copyMessage(user.partner_id);
        } catch (e) {
            // Partner might have blocked the bot
            db.updateStatus(ctx.from.id, 'idle');
            db.updateStatus(user.partner_id, 'idle');
            ctx.reply('Sherik bilan aloqa uzildi.', mainKeyboard);
        }
    } else {
        const commands = ['🔎 Qidiruv', '💰 DICO sotib olish', '👤 Profil', '🏆 Reyting', '📜 Qoidalar', '❌ Suhbatni yakunlash', '❌ Qidiruvni to\'xtatish', '👤 Profilini ko\'rish'];
        if (ctx.message.text && !commands.includes(ctx.message.text)) {
            ctx.reply('Botdan foydalanish uchun tugmalardan foydalaning yoki sherik toping.');
        }
    }
});

bot.launch().then(() => console.log('Bot is active!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
