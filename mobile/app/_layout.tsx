import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { registerBackgroundSync } from '../src/sync/backgroundSync';
import { registerPairingForPush, registerPushSyncTask } from '../src/sync/pushSync';
import { installPhotoEditorNavigationBridge } from '../src/editor/EditorNavigationBridge';

installPhotoEditorNavigationBridge();

export default function RootLayout() {
  useEffect(() => {
    void registerBackgroundSync();
    void registerPushSyncTask();
    void registerPairingForPush();
  }, []);
  return <><StatusBar style="light" /><Stack screenOptions={{ headerShown: false }} /></>;
}
