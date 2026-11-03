import { ConfigPlugin, createRunOncePlugin, withDangerousMod } from '@expo/config-plugins';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Expo Config Plugin to copy KasuwaKeyModule native source files into the generated
 * android and ios project directories during `expo prebuild`.
 */
const withKasuwaKeyModule: ConfigPlugin = (config) => {
  // Android integration
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const srcDir = path.resolve(cfg.modRequest.projectRoot, 'android/app/src/main/java/com/kasuwa/keymodule');
      const destDir = path.resolve(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java/com/kasuwa/keymodule',
      );
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        for (const file of fs.readdirSync(srcDir)) {
          fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        }
      }
      return cfg;
    },
  ]);

  // iOS integration
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const srcDir = path.resolve(cfg.modRequest.projectRoot, 'ios/KasuwaKeyModule');
      const destDir = path.resolve(cfg.modRequest.platformProjectRoot, 'KasuwaKeyModule');
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        for (const file of fs.readdirSync(srcDir)) {
          fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        }
      }
      return cfg;
    },
  ]);

  return config;
};

export default createRunOncePlugin(withKasuwaKeyModule, 'withKasuwaKeyModule', '0.1.0');
