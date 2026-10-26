// Auto-reply for the demo "seller" accounts (is_bot = 1), so the chat flow can be tried alone.
import { db, uid, listingRow, notify } from './db.js';
import { HOURS_CATS } from './catalog.js';

const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const kmFmt = n => Number(n || 0).toLocaleString('en-IN') + ' KM';
const usageFmt = l => HOURS_CATS.includes(l.category) ? Number(l.km).toLocaleString('en-IN') + ' hrs' : kmFmt(l.km);
const ART_VIEWS = ['side','flip','rear','interior','cab','dusk'];

  function respond(l, text){
    const t = text.toLowerCase();
    const num = (t.replace(/,/g,'').match(/(\d+(\.\d+)?)\s*(l|lakh|lakhs|lac)?\b/)||[]);
    let offer = 0;
    if (num[1]){ offer = parseFloat(num[1]); if (num[3]) offer *= 1e5; }
    if (offer >= 10000 && /(offer|give|pay|final|can you do|for|₹|rs|lakh|lac)/.test(t) || offer >= 100000){
      if (offer >= l.price) return {text:`That works. ${inr(l.price)} is the listed price — come and check the vehicle and we can close it.`};
      if (offer >= l.price*0.93) return {text:`${inr(Math.round(offer))} is acceptable if you can pay the token advance this week. When would you like to visit?`};
      const best = Math.round(l.price*0.95/5000)*5000;
      return {text:`${inr(Math.round(offer))} is too low for this vehicle. The best I can do is ${inr(best)}.`};
    }
    if (/\b(hi|hello|hey|namaste|namaskar)\b/.test(t) && t.length < 25) return {text:`Hello! Thanks for your interest in the ${l.title}. How can I help?`};
    if (/(available|still there|sold)/.test(t)) return {text:'Yes, it is still available.\nTell me if you need more details.'};
    if (/(condition|service|history|photo|image|picture|pic)/.test(t)) return {text:'Sure, the vehicle is in excellent condition.\nAll services are done regularly.\nYou can check the images for more details.', images: ART_VIEWS.slice(0,4).map(v=>'art:'+l.id+':'+v), photos:true};
    if (/(price|final|negotiable|last|best|discount|rate|cost)/.test(t)) return {text:`The price is ${inr(l.price)} and ${l.negotiable?'slightly negotiable':'fixed'}.\nYou can come and check the vehicle.`};
    if (/(km|kilomet|driven|run|hours|hrs)/.test(t)) return {text:`It has done ${usageFmt(l)}. Mostly ${HOURS_CATS.includes(l.category)?'light farm and site work':'highway running'}, no major repairs.`};
    if (/(paper|document|rc|insurance|permit|fitness|noc|tax)/.test(t)) return {text:'All papers are clear and up to date — RC, insurance, fitness and permit. NOC can be arranged for transfer.'};
    if (/(loan|finance|emi)/.test(t)) return {text:'Yes, loan is possible on this vehicle. Tap "Check Finance Options" on the listing and the Autoreboot team will help you with the best offers.'};
    if (/(visit|tomorrow|come|location|address|where|see)/.test(t)) return {text:`Sure, you're welcome. The vehicle is at our yard in ${l.city}. Message me here before you leave and I'll share the exact location.`};
    if (/(tyre|tire)/.test(t)) return {text:`${l.tyres ? l.tyres+' tyres, ' : ''}${(l.highlights||[]).includes('New Tyres')?'all recently replaced.':'in good condition with plenty of life left.'}`};
    if (/(owner|ownership)/.test(t)) return {text:`It is a ${l.ownership.toLowerCase()} vehicle.`};
    if (/(thank|ok|okay|fine|great|sure)/.test(t)) return {text:'You are welcome. Let me know if you need anything else.'};
    if (/(accident|damage)/.test(t)) return {text:'No accidents. The chassis and body are original. You can get it inspected when you visit.'};
    return {text:'Thanks for your message. I will check and get back to you shortly.'};
  }

function send(chatId, senderId, text, images = []) {
  const now = Date.now();
  db.prepare('INSERT INTO messages (id,chat_id,sender_id,text,images,created_at) VALUES (?,?,?,?,?,?)')
    .run(uid('m_'), chatId, senderId, text, JSON.stringify(images), now);
  db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(now, chatId);
}

export function scheduleBotReply(chat, msg) {
  const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(chat.listing_id);
  if (!row) return;
  const l = listingRow(row);
  const r = msg.images?.length && !msg.text ? { text: 'Got the photos, thank you.' } : respond(l, msg.text || '');
  const delay = 1800 + Math.min(1500, r.text.length * 12);
  setTimeout(() => {
    try {
      if (!db.prepare('SELECT 1 FROM chats WHERE id = ?').get(chat.id)) return; // conversation was deleted
      send(chat.id, chat.seller_id, r.text);
      if (r.images) send(chat.id, chat.seller_id, '', r.images);
      const seller = db.prepare('SELECT name FROM users WHERE id = ?').get(chat.seller_id);
      notify(chat.buyer_id, { title: `${seller?.name || 'Seller'} replied`, body: r.text, link: '#/chat/' + chat.id, icon: 'msg' });
    } catch (e) { console.error('bot reply failed', e); }
  }, delay).unref();
}
