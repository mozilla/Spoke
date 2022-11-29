// Adapted from https://github.com/codepo8/canvasthumber
function resize(imageWidth, imageHeight, thumbWidth, thumbHeight) {
  let w = 0,
    h = 0,
    x = 0,
    y = 0;
  const widthRatio = imageWidth / thumbWidth,
    heightRatio = imageHeight / thumbHeight,
    maxRatio = Math.max(widthRatio, heightRatio);
  if (maxRatio > 1) {
    w = imageWidth / maxRatio;
    h = imageHeight / maxRatio;
  } else {
    w = imageWidth;
    h = imageHeight;
  }
  x = (thumbWidth - w) / 2;
  y = (thumbHeight - h) / 2;
  return { w: w, h: h, x: x, y: y };
}

export async function generateImageFileThumbnail(file, width, height, crop, background) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.src = url;
    img.onload = resolve;
    img.onerror = reject;
  });
  URL.revokeObjectURL(url);
  return generateMediaThumbnail(img, width, height, crop, background);
}

export async function generateVideoFileThumbnail(file, width, height, background) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  await new Promise((resolve, reject) => {
    video.src = url;
    video.oncanplay = resolve;
    video.onerror = reject;
  });
  URL.revokeObjectURL(url);
  await new Promise((resolve, reject) => {
    video.currentTime = 1;
    video.onseeked = resolve;
    video.onerror = reject;
  });
  return generateMediaThumbnail(video, width, height, background);
}

export async function generateMediaThumbnail(el, width = 256, height = 256, background = "#000") {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  const dimensions = resize(el.width || el.videoWidth, el.height || el.videoHeight, width, height);
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(el, dimensions.x, dimensions.y, dimensions.w, dimensions.h);

  if (background === "transparent") {
    return getCanvasBlob(canvas, "image/png");
  } else {
    return getCanvasBlob(canvas);
  }
}

export function getCanvasBlob(canvas, fileType = "image/jpeg", quality = 0.9) {
  if (canvas.msToBlob) {
    return Promise.resolve(canvas.msToBlob());
  } else {
    return new Promise(resolve => canvas.toBlob(resolve, fileType, quality));
  }
}
