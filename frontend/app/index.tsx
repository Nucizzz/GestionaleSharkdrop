import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/store/authStore';

export default function Index() {
  const router = useRouter();
  const { token, isLoading } = useAuthStore();

  useEffect(() => {
    if (!isLoading) {
      if (token) {
        router.replace('/(tabs)');
      } else {
        router.replace('/login');
      }
    }
  }, [token, isLoading]);

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Image source={require('../LOGOSHARKDROP.png')} style={styles.logoImage} resizeMode="contain" />
        <Text style={styles.logo}>SharkDrop</Text>
        <Text style={styles.subtitle}>WMS</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
  },
  logoImage: {
    width: 120,
    height: 120,
    marginBottom: 16,
  },
  logo: {
    fontSize: 36,
    fontWeight: '800',
    color: '#000',
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginTop: 4,
  },
});

