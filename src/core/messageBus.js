export class MessageBus {
  constructor() {
    this.handlers = new Map();
  }

  subscribe(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    const set = this.handlers.get(type);
    set.add(handler);
    return () => set.delete(handler);
  }

  publish(type, payload = {}) {
    const set = this.handlers.get(type);
    if (!set || set.size === 0) return;
    for (const handler of set) handler(payload);
  }
}
