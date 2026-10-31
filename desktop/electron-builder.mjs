export default {
  appId: 'com.apdf.local', productName: 'APDF Local',
  electronVersion: '45.2.1',
  directories: { app: 'desktop/.build/app', output: 'desktop/releases', buildResources: 'desktop/.build/icons' },
  files: ['**/*'], asar: true, npmRebuild: false, forceCodeSigning: false,
  artifactName: 'APDF-Local-${version}-${os}-${arch}.${ext}',
  linux: { target: ['tar.gz'], executableName: 'apdf-local', icon: 'desktop/.build/icons/icon.png', category: 'Office', synopsis: 'Offline PDF editor and assembler' },
  win: { target: ['portable', 'zip'], icon: 'desktop/.build/icons/icon.ico', signExecutable: false, signAndEditExecutable: process.platform === 'win32' },
  portable: { requestExecutionLevel: 'user' },
  mac: { target: ['dmg', 'zip'], icon: 'desktop/.build/icons/icon.icns', identity: '-', category: 'public.app-category.productivity' },
};
