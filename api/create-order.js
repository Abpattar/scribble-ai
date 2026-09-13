import Razorpay from 'razorpay';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const keyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return response.status(500).json({ error: 'Razorpay server configuration is missing.' });
  }

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order = await razorpay.orders.create({
      amount: 9900,
      currency: 'INR',
      receipt: `scribble-air-${Date.now()}`,
      notes: { product: 'Scribble Air Pro' },
    });

    return response.status(200).json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId });
  } catch (error) {
    console.error('Razorpay order creation failed', error);
    return response.status(502).json({ error: 'Unable to create a Razorpay order.' });
  }
}
