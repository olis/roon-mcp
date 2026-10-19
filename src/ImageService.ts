import { RoonClient } from "./RoonClient.js";

/** Retrieves only opaque Roon image keys, never arbitrary URLs. */
export class ImageService {
  constructor(private readonly roon: RoonClient) {}

  async getImage(imageKey: string, size = 600) {
    if (!imageKey || imageKey.length > 512 || /[\x00-\x1f\x7f]/.test(imageKey)) throw new Error("Invalid Roon image key.");
    if (!Number.isInteger(size) || size < 64 || size > 1200) throw new Error("Image size must be 64–1200 pixels.");
    await this.roon.waitForCore();
    const service = this.roon.getImage();
    return new Promise<{ mimeType: string; data: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Roon image request timed out.")), 10000);
      try {
        service.get_image(imageKey, { width: size, height: size, scale: "fit", format: "image/jpeg" }, (error, mimeType, body) => {
          clearTimeout(timer);
          if (error) return reject(new Error(`Roon image unavailable: ${error}`));
          if (!mimeType || !["image/jpeg", "image/png"].includes(mimeType) || !Buffer.isBuffer(body) || !body.length || body.length > 3 * 1024 * 1024) {
            return reject(new Error("Roon returned an invalid or oversized image."));
          }
          resolve({ mimeType, data: body.toString("base64") });
        });
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  }
}
