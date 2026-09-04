import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MobileHome from '../src/home/MobileHome';

export default function MobileHomeRoute() {
  return <View style={styles.root}>
    <MobileHome />
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Mở Workspace và dung lượng"
      style={styles.workspaceShortcut}
      onPress={() => router.push('/workspace')}
    >
      <Text style={styles.workspaceShortcutText}>Workspace & dung lượng</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  workspaceShortcut: {
    position: 'absolute',
    right: 16,
    bottom: 92,
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: '#1769e0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  workspaceShortcutText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
