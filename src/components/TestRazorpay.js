
const Razorpay = require("razorpay");
const { default: orders } = require("razorpay/dist/types/orders");

const razorpayKeyId = "rzp_test_S9gk8Rymd2M1"
const razorpayKeySecret = "kocYfhRUDPdjgD2zW 2GM3gel"


// ========================================
// CREATE RAZORPAY ORDER
// ========================================

exports.createRazorpayOrder = onCall(
  {
    secrets: [razorpayKeyId, razorpayKeySecret],
  },

  async (request) => {
    // Check user login
    // if (!request.auth) {
    //   throw new HttpsError(
    //     "unauthenticated",
    //     "You must be logged in."
    //   );
    // }

    try {
      const razorpay = new Razorpay({
        key_id: razorpayKeyId,
        key_secret: razorpayKeySecret,
      });

      // ₹50 payment
      const amount = 50 * 100;

      const options = {
        amount: amount,
        currency: "INR"
      };

      const order = await razorpay.orders.create(options);
      console.log(order)
            return {
        success: true,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: razorpayKeyId.value(),
      };

    } catch (error) {
      console.error("Razorpay order error:", error);

      throw new HttpsError(
        "internal",
        "Unable to create Razorpay order."
      );
    }
  }
);


// ========================================
// VERIFY RAZORPAY PAYMENT
// ========================================

exports.verifyRazorpayPayment = onCall(
  {
    secrets: [razorpayKeySecret],
  },

  async (request) => {

    // Check login
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be logged in."
      );
    }

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = request.data;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Payment information is incomplete."
      );
    }

    try {

      // Generate signature
      const generatedSignature = crypto
        .createHmac(
          "sha256",
          razorpayKeySecret.value()
        )
        .update(
          `${razorpay_order_id}|${razorpay_payment_id}`
        )
        .digest("hex");


      // Compare signatures
      if (generatedSignature !== razorpay_signature) {

        throw new HttpsError(
          "permission-denied",
          "Payment verification failed."
        );
      }


      // ====================================
      // PAYMENT SUCCESS
      // ====================================

      const uid = request.auth.uid;

      const userRef = db
        .collection("users")
        .doc(uid);


      await userRef.set(
        {
          isPaid: true,
          paymentId: razorpay_payment_id,
          orderId: razorpay_order_id,
          paymentUpdatedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        }
      );


      return {
        success: true,
        message: "Payment verified successfully.",
      };

    } catch (error) {

      console.error(
        "Payment verification error:",
        error
      );

      throw new HttpsError(
        "internal",
        "Payment verification failed."
      );
    }
  }
);

export default createRazorpayOrder;