import { MSG } from "../core/messages.js";
import { TEMPLATE_REGISTRY } from "./templateRegistry.js";

export class TemplateManager {
  constructor({ bus, paperSimulator }) {
    this.bus = bus;
    this.paperSimulator = paperSimulator;
    this.currentTemplateId = null;
    this.currentEvaluator = null;
  }

  getPaperSize() {
    return {
      width: this.paperSimulator.paper.width,
      height: this.paperSimulator.paper.height,
    };
  }

  getCurrentTemplateId() {
    return this.currentTemplateId;
  }

  /**
   * @param {string} templateId
   * @param {{ force?: boolean }} [options] force=true 이면 같은 템플릿도 다시 마운트
   */
  loadTemplate(templateId, options = {}) {
    const { force = false } = options;
    if (!force && this.currentTemplateId === templateId) return;

    const desc = TEMPLATE_REGISTRY[templateId];
    if (!desc) {
      console.warn(`Template "${templateId}" not found.`);
      return;
    }

    if (this.currentEvaluator && typeof this.currentEvaluator.destroy === "function") {
      this.currentEvaluator.destroy();
      this.currentEvaluator = null;
    }

    this.currentTemplateId = templateId;
    this.currentEvaluator = desc.createEvaluator({
      bus: this.bus,
      paperSize: this.getPaperSize(),
    });

    this.bus.publish(MSG.TEMPLATE_CHANGED, {
      templateId: desc.id,
      name: desc.name,
      ui: { ...desc.ui },
    });

    this.bus.publish(MSG.UI_SET_HINT, {
      text: `${desc.name} 접기 모드를 선택했습니다.`,
    });
  }
}
