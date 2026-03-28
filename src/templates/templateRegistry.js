import { AirplaneEvaluator } from "../modules/airplaneEvaluator.js";
import { FlowerEvaluator } from "./flowerTemplate.js";

/**
 * 템플릿 등록: 각 도안은 평가기(Evaluator)와 UI/공통 동작 플래그를 가진다.
 * 공통 기하·점수 유틸은 ../utils/evaluationUtils.js 등에서 재사용.
 */
export const TEMPLATE_REGISTRY = Object.freeze({
  airplane: {
    id: "airplane",
    name: "비행기",
    ui: Object.freeze({
      spreadWingButton: true,
      wingSpreadOnStandFlat: true,
    }),
    createEvaluator: ({ bus, paperSize }) =>
      new AirplaneEvaluator({ bus, paperSize }),
  },
  flower: {
    id: "flower",
    name: "꽃",
    ui: Object.freeze({
      spreadWingButton: false,
      wingSpreadOnStandFlat: false,
    }),
    createEvaluator: ({ bus, paperSize }) =>
      new FlowerEvaluator({ bus, paperSize }),
  },
});

export function listTemplateIds() {
  return Object.keys(TEMPLATE_REGISTRY);
}
