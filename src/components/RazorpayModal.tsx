import { useState, type CSSProperties } from 'react';
import { useClerk } from '@clerk/clerk-react';

interface Props {
  title: string;
  description: string;
  amount: number; // in rupees
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

type Method = 'upi' | 'card' | 'netbanking';
type Step = 'method' | 'details' | 'processing' | 'success' | 'failed';

const RAZORPAY_SCRIPT_ID = 'razorpay-checkout-script';
const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

const PAYEE_NAME = 'Scribble Air Draw';

function loadRazorpayScript() {
  return new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }

    const existing = document.getElementById(RAZORPAY_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if ((window as any).Razorpay) {
        resolve(true);
        return;
      }
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = RAZORPAY_SCRIPT_ID;
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(Boolean((window as any).Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function RazorpayModal({ title, description, amount, onClose, onSuccess }: Props) {
  const { session } = useClerk();
  const [method, setMethod] = useState<Method>('upi');
  const [step, setStep] = useState<Step>('method');
  const [upiId, setUpiId] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  function proceedToDetails() {
    setStep('details');
  }

  async function pay() {
    setErrorMessage('');
    setStep('processing');

    try {
      const orderResponse = await fetch('/api/create-order', { method: 'POST' });
      const orderData = await orderResponse.json().catch(() => ({}));
      if (!orderResponse.ok || !orderData.orderId || !orderData.keyId) {
        throw new Error(orderData.error || `Payment server returned HTTP ${orderResponse.status}`);
      }

      const loaded = await loadRazorpayScript();
      if (!loaded || !(window as any).Razorpay) {
        throw new Error('Razorpay checkout script failed to load');
      }

      const razorpay = new (window as any).Razorpay({
        key: orderData.keyId,
        order_id: orderData.orderId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: PAYEE_NAME,
        description: title,
        handler: async function (response: any) {
          try {
            const idToken = await session?.getToken();
            const verificationResponse = await fetch('/api/verify-payment', {
              method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...response, idToken }),
    });
    const verification = await verificationResponse.json();
    if (!verificationResponse.ok || !verification.verified) {
      throw new Error(verification.error || 'Payment verification failed');
    }
    setStep('success');
    await onSuccess();
    window.setTimeout(onClose, 1200);
  } catch (error) {
    console.error('Razorpay payment verification failed', error);
    setStep('failed');
  }
},
        prefill: {
          method,
          ...(method === 'upi' && upiId ? { vpa: upiId } : {}),
          ...(method === 'card'
            ? {
                name: 'Demo User',
                number: cardNumber || '4111111111111111',
                expiry: expiry || '12/29',
                cvv: cvv || '123',
              }
            : {}),
        },
        notes: {
          plan: title,
          source: 'neon-air-draw',
        },
        theme: { color: '#3399cc' },
        modal: {
          ondismiss: () => setStep('method'),
        },
      });

      razorpay.open();
    } catch (error) {
      console.error('Razorpay checkout failed', error);
      setErrorMessage(error instanceof Error ? error.message : 'Unable to start Razorpay Checkout.');
      setStep('failed');
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 90 }}>
      <div
        style={{
          width: 360,
          maxWidth: '92vw',
          borderRadius: 14,
          overflow: 'hidden',
          background: '#fff',
          color: '#1a1a2e',
          fontFamily: "'Space Grotesk', sans-serif",
          boxShadow: '0 30px 90px -20px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ background: '#072654', padding: '16px 18px', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  background: '#3399cc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                R
              </div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Razorpay</span>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, opacity: 0.85 }}>{title}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>₹{amount}</div>
        </div>

        <div style={{ padding: 18 }}>
          {step === 'method' && (
            <>
              <div style={{ fontSize: 11.5, color: '#666', marginBottom: 10 }}>{description}</div>
              {(
                [
                  { id: 'upi', label: 'UPI', hint: 'Pay securely with Razorpay' },
                  { id: 'card', label: 'Card', hint: 'Credit / Debit card' },
                  { id: 'netbanking', label: 'Netbanking', hint: 'All major banks' },
                ] as { id: Method; label: string; hint: string }[]
              ).map((m) => (
                <div
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '11px 12px',
                    borderRadius: 9,
                    border: method === m.id ? '1.5px solid #3399cc' : '1.5px solid #e5e5e5',
                    background: method === m.id ? '#f0f9ff' : '#fff',
                    marginBottom: 8,
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{m.label}</div>
                    <div style={{ fontSize: 10.5, color: '#888' }}>{m.hint}</div>
                  </div>
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: method === m.id ? '5px solid #3399cc' : '1.5px solid #ccc',
                    }}
                  />
                </div>
              ))}
              <button
                onClick={method === 'upi' ? pay : proceedToDetails}
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: 12,
                  borderRadius: 9,
                  border: 'none',
                  background: '#3399cc',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {method === 'upi' ? `Pay ₹${amount} via UPI` : 'Continue'}
              </button>
              <div
                onClick={onClose}
                style={{ textAlign: 'center', fontSize: 11.5, color: '#999', marginTop: 12, cursor: 'pointer' }}
              >
                Cancel
              </div>
            </>
          )}

          {step === 'details' && (
            <>
              {method === 'card' && (
                <>
                  <input
                    placeholder="Card number"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    style={{ ...detailsInputStyle, marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      placeholder="MM/YY"
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      style={{ ...detailsInputStyle, flex: 1 }}
                    />
                    <input
                      placeholder="CVV"
                      value={cvv}
                      onChange={(e) => setCvv(e.target.value)}
                      style={{ ...detailsInputStyle, flex: 1 }}
                    />
                  </div>
                </>
              )}
              {method === 'netbanking' && (
                <select style={detailsInputStyle} defaultValue="">
                  <option value="" disabled>
                    Select your bank
                  </option>
                  <option>State Bank of India</option>
                  <option>HDFC Bank</option>
                  <option>ICICI Bank</option>
                  <option>Axis Bank</option>
                </select>
              )}

              <button
                onClick={pay}
                style={{
                  width: '100%',
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 9,
                  border: 'none',
                  background: '#3399cc',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Pay ₹{amount}
              </button>
              <div
                onClick={() => setStep('method')}
                style={{ textAlign: 'center', fontSize: 11.5, color: '#999', marginTop: 12, cursor: 'pointer' }}
              >
                Back
              </div>
            </>
          )}

          {step === 'processing' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  margin: '0 auto 14px',
                  borderRadius: '50%',
                  border: '3px solid #e5e5e5',
                  borderTopColor: '#3399cc',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <div style={{ fontSize: 12.5, color: '#555' }}>Opening Razorpay Checkout…</div>
            </div>
          )}

          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  margin: '0 auto 12px',
                  borderRadius: '50%',
                  background: '#22c55e',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                }}
              >
                ✓
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Payment successful</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Unlocking cartoons…</div>
            </div>
          )}

          {step === 'failed' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  margin: '0 auto 12px',
                  borderRadius: '50%',
                  background: '#ef4444',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                }}
              >
                !
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Payment couldn't start</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2, wordBreak: 'break-word' }}>
                {errorMessage || 'Please try again.'}
              </div>
              <button
                onClick={() => setStep('method')}
                style={{
                  width: '100%',
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 9,
                  border: 'none',
                  background: '#3399cc',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const detailsInputStyle: CSSProperties = {
  width: '100%',
  padding: '11px 12px',
  borderRadius: 9,
  border: '1.5px solid #e5e5e5',
  fontSize: 13,
  outline: 'none',
  fontFamily: "'Space Grotesk', sans-serif",
};