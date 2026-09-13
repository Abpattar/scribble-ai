import createRazorpayOrder from "./TestRazorpay"
function Razorpay() {
  const handleClick = (): void => {
    createRazorpayOrder()
  };

  return (
    <div>
      <button onClick={handleClick}>
        Click Me
      </button>
    </div>
  );
}

export default Razorpay;