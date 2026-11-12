import { useEffect, useState } from "react";

// True at 760px and under, where the phone layouts apply (the same breakpoint as the CSS).
const query = "(max-width: 760px)";
export function usePhone() {
  const [phone, setPhone] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}
