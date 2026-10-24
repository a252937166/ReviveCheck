// Motion helpers shared by the landing and the app: entry reveals, rolling
// numerals and timed sequences. Everything renders its final state at once
// under prefers-reduced-motion, and nothing here hides content when JS fails.
import React, { useEffect, useRef, useState } from 'react';

export const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True once the element has entered the viewport (or at once under reduced motion). */
export function useInView(threshold = 0.2, rootMargin = '0px 0px -8% 0px') {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (reduceMotion() || typeof IntersectionObserver !== 'function') { setInView(true); return undefined; }
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect(); } }, { threshold, rootMargin });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, inView];
}

/** A block that rises into place as it enters. `delay` staggers siblings; keep it under ~300ms. */
export function Reveal({ as: Tag = 'div', className = '', delay = 0, children, ...rest }) {
  const [ref, inView] = useInView(0.12);
  return <Tag ref={ref} className={`reveal ${inView ? 'in' : ''} ${className}`.trim()} style={delay ? { transitionDelay: `${delay}ms` } : undefined} {...rest}>{children}</Tag>;
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
/**
 * A rolling numeral: every digit is a column that rolls to its value, so a live
 * block number ticks digit by digit. `value` is the formatted string.
 */
export function Odometer({ value, start = true, className = '' }) {
  const text = String(value ?? '');
  const [armed, setArmed] = useState(() => reduceMotion());
  useEffect(() => {
    if (armed || !start) return undefined;
    if (reduceMotion()) { setArmed(true); return undefined; }
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setArmed(true)); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
  }, [start, armed]);
  return <span className={`odo ${className}`.trim()}>
    <span className="visually-hidden">{text}</span>
    {[...text].map((char, index) => /\d/.test(char)
      ? <span key={index} className="odo-col" aria-hidden="true"><span className="odo-strip" style={{ transform: `translateY(-${armed ? Number(char) * 10 : 0}%)`, transitionDelay: `${Math.min(index, 8) * 45}ms` }}>{DIGITS.map((digit) => <span key={digit}>{digit}</span>)}</span></span>
      : <span key={index} className={`odo-ch ${char === '#' ? 'odo-hash' : ''}`.trim()} aria-hidden="true">{char}</span>)}
  </span>;
}

/**
 * A step counter that advances on a timer: returns how many steps have fired.
 * Starts at `total` under reduced motion, and only once `start` is true.
 */
export function useSequence(total, { start = true, delay = 500, gap = 550 } = {}) {
  const [phase, setPhase] = useState(() => reduceMotion() ? total : 0);
  useEffect(() => {
    if (!start || reduceMotion()) return undefined;
    setPhase(0);
    const timers = [];
    for (let step = 1; step <= total; step += 1) timers.push(setTimeout(() => setPhase(step), delay + (step - 1) * gap));
    return () => timers.forEach(clearTimeout);
  }, [start, total, delay, gap]);
  return phase;
}

/** An index that advances every `interval` ms until the visitor interacts; `select` stops the clock. */
export function useAutoAdvance(count, interval = 5000, active = true) {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(() => !reduceMotion());
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (!auto || !active || reduceMotion()) return undefined;
    const timer = setTimeout(() => { setIndex((current) => (current + 1) % count); setCycle((value) => value + 1); }, interval);
    return () => clearTimeout(timer);
  }, [auto, active, index, count, interval, cycle]);
  const select = (next) => { setAuto(false); setIndex(next); };
  return { index, select, auto: auto && active, cycle };
}
