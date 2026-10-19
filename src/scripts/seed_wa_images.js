const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('pocketbase/pb_data/data.db');

const chatId = 'chat_rajkot_001';
const existsChat = db.prepare('SELECT id FROM whatsapp_chats WHERE id = ?').get(chatId);
if (!existsChat) {
  db.prepare(`INSERT INTO whatsapp_chats (id, chat_id, contact_name, contact_type, last_message_body, last_message_time, unread_count, status, labels)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    chatId,
    '919876543210@c.us',
    'Rajkot Heritage Jewellers (Kishan Bhai)',
    'vendor',
    'Antique Kemp Necklaces & Jhumka Sets Ready for Dispatch',
    new Date().toISOString(),
    1,
    'active',
    JSON.stringify(['Vendor', 'Temple'])
  );
  console.log('Inserted chat:', chatId);
}

const images = [
  {
    id: 'msg_img_001',
    body: 'Temple Kemp Choker 22K Micro Gold Polish with Ruby Stone Clusters. Lot #TK-842',
    media_url: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?w=600&auto=format&fit=crop&q=80',
    sender_name: 'Kishan Bhai (Rajkot)'
  },
  {
    id: 'msg_img_002',
    body: 'Kundan Antique Peacock Jhumka Earrings with Pearls. Model KD-902',
    media_url: 'https://images.unsplash.com/photo-1630019852942-f89202989a59?w=600&auto=format&fit=crop&q=80',
    sender_name: 'Kishan Bhai (Rajkot)'
  },
  {
    id: 'msg_img_003',
    body: 'Matte Finish Lakshmi Coin Haar Long Necklace 24 inch. Lot LK-114',
    media_url: 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=600&auto=format&fit=crop&q=80',
    sender_name: 'Kishan Bhai (Rajkot)'
  }
];

for (const img of images) {
  const exists = db.prepare('SELECT id FROM whatsapp_messages WHERE id = ?').get(img.id);
  if (!exists) {
    db.prepare(`INSERT INTO whatsapp_messages (id, chat, message_id, from_me, sender_name, body, message_type, media_url, status, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      img.id,
      chatId,
      'wa_' + img.id,
      0,
      img.sender_name,
      img.body,
      'image',
      img.media_url,
      'delivered',
      new Date().toISOString()
    );
    console.log('Inserted message:', img.id);
  }
}
console.log('Done!');
