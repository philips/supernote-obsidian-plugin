export default function maybeToPrecision(value, digits) {
  if (value < 0) {
    value = 0 - value;
    if (typeof digits === 'number') {
      return `- ${value.toPrecision(digits)}`;
    } else {
      return `- ${value.toString()}`;
    }
  } else {
    if (typeof digits === 'number') {
      return value.toPrecision(digits);
    } else {
      return value.toString();
    }
  }
}
