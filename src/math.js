function clamp (x, low, high) {
    return Math.min(Math.max(x, low), high);
}

function remap01 (x, low, high) {
    return clamp((x - low) / (high - low), 0, 1);
}

function remap (x, lowIn, highIn, lowOut, highOut) {
    return lowOut + (highOut - lowOut) * remap01(x, lowIn, highIn);
}