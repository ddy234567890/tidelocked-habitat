// 지형 색은 이 파일에서만 만든다. 화면 배경색과는 별개다.
const BLUE = [0x42 / 255, 0x91 / 255, 0xdf / 255];
const CREAM = [0xf2 / 255, 0xeb / 255, 0xdb / 255];
const ORANGE = [1, 0x99 / 255, 0x3d / 255];
const clamp = v => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
export const blue = (brightness = 1) => BLUE.map(v => v * brightness);
export const cream = (brightness = 1) => CREAM.map(v => v * brightness);
export const orange = (brightness = 1) => ORANGE.map(v => v * brightness);
export function temperatureColor(value, range) {
  const t = clamp((value - range[0]) / (range[1] - range[0] || 1));
  return t < 0.68 ? mix(BLUE, CREAM, t / 0.68) : mix(CREAM, ORANGE, (t - 0.68) / 0.32);
}
export const shade = (color, brightness) => color.map(v => v * Math.max(0, Math.min(1, brightness)));
