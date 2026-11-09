import { Config } from "@remotion/cli/config";

// Master render settings — GrovBase Rolka #2 (1080x1920, 30 FPS, H.264/yuv420p, AAC 48 kHz).
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setCrf(17);
Config.setAudioCodec("aac");
Config.setAudioBitrate("320k");
Config.setColorSpace("bt709");
Config.setOverwriteOutput(true);

// In sandboxed environments without internet access to the Chrome-for-Testing CDN,
// point Remotion at a local chrome-headless-shell, e.g.
//   REMOTION_BROWSER=/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell
if (process.env.REMOTION_BROWSER) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER);
}
