import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '../src/store/authStore';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';

export default function RootLayout() {
  const { isLoading, loadAuth } = useAuthStore();

  useEffect(() => {
    loadAuth();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (document.getElementById('sharkdrop-web-fixes')) return;
    const style = document.createElement('style');
    style.id = 'sharkdrop-web-fixes';
    style.innerHTML = `
      html, body {
        -webkit-text-size-adjust: 100%;
        text-size-adjust: 100%;
      }
      input, textarea, select {
        -webkit-text-size-adjust: 100%;
        text-size-adjust: 100%;
      }
    `;
    document.head.appendChild(style);
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="operation" options={{ presentation: 'card' }} />
        <Stack.Screen name="admin" options={{ presentation: 'card' }} />
        <Stack.Screen name="product-detail" options={{ presentation: 'card' }} />
        <Stack.Screen name="caricaprodottionline" options={{ presentation: 'card' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
});
