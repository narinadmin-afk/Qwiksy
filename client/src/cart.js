import { useSyncExternalStore } from 'react';

/**
 * ตะกร้าสินค้า (localStorage) - เก็บแค่ productId + quantity
 * ราคา/ส่วนลดทั้งหมดมาจาก Backend เสมอ ไม่เก็บราคาไว้ฝั่งนี้
 */
const KEY = 'dmp_cart_v1';
let cart = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCart() {
  const items = useSyncExternalStore(subscribe, () => cart);
  return {
    items,
    count: items.reduce((s, i) => s + i.quantity, 0),
    add(productId, quantity = 1) {
      const existing = cart.find((i) => i.productId === productId);
      if (existing) {
        existing.quantity = Math.min(existing.quantity + quantity, 99);
      } else {
        cart = [...cart, { productId, quantity: Math.min(quantity, 99) }];
      }
      persist();
    },
    setQuantity(productId, quantity) {
      if (quantity <= 0) {
        cart = cart.filter((i) => i.productId !== productId);
      } else {
        cart = cart.map((i) =>
          i.productId === productId ? { ...i, quantity: Math.min(quantity, 99) } : i
        );
      }
      persist();
    },
    remove(productId) {
      cart = cart.filter((i) => i.productId !== productId);
      persist();
    },
    clear() {
      cart = [];
      persist();
    },
  };
}
