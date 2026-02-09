import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/services/api';
import { useAuthStore } from '../../src/store/authStore';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();
  const [stats, setStats] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = async () => {
    try {
      const data = await api.getDashboardStats();
      setStats(data);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  }, []);

  const quickActions = [
    { icon: 'add-circle-outline', label: 'Ricevi', action: 'receive', color: '#16a34a' },
    { icon: 'swap-horizontal-outline', label: 'Sposta', action: 'move', color: '#2563eb' },
    { icon: 'arrow-forward-outline', label: 'Trasferisci', action: 'transfer', color: '#7c3aed' },
    { icon: 'cart-outline', label: 'Vendita', action: 'sale', color: '#dc2626' },
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.greeting}>Ciao, {user?.username || 'Utente'}</Text>
          <Text style={styles.subtitle}>SharkDrop WMS</Text>
        </View>
        <Image source={require('../../LOGOSHARKDROP.png')} style={styles.logoImage} resizeMode="contain" />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {stats && stats.total_products === 0 && (
          <View style={styles.noticeCard}>
            <Ionicons name="information-circle-outline" size={22} color="#2563eb" />
            <View style={styles.noticeTextWrap}>
              <Text style={styles.noticeTitle}>
                {stats.shopify_sync_status === 'syncing' ? 'Sync Shopify in corso' : 'Prodotti non sincronizzati'}
              </Text>
              <Text style={styles.noticeText}>
                {stats.shopify_sync_status === 'syncing'
                  ? 'Attendi il completamento della sincronizzazione.'
                  : 'Vai in Impostazioni > Shopify per importare i prodotti.'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.noticeButton}
              onPress={() => router.push('/(tabs)/settings')}
            >
              <Text style={styles.noticeButtonText}>Apri</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Stats Cards */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Ionicons name="cube-outline" size={24} color="#000" />
            <Text style={styles.statValue}>{stats?.total_products || 0}</Text>
            <Text style={styles.statLabel}>Prodotti</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="layers-outline" size={24} color="#000" />
            <Text style={styles.statValue}>{stats?.total_inventory || 0}</Text>
            <Text style={styles.statLabel}>Pezzi Totali</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="location-outline" size={24} color="#000" />
            <Text style={styles.statValue}>{stats?.total_locations || 0}</Text>
            <Text style={styles.statLabel}>Location</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="receipt-outline" size={24} color="#000" />
            <Text style={styles.statValue}>{stats?.today_transactions || 0}</Text>
            <Text style={styles.statLabel}>Oggi</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Azioni Rapide</Text>
        <View style={styles.actionsGrid}>
          {quickActions.map((action, index) => (
            <TouchableOpacity
              key={index}
              style={styles.actionButton}
              onPress={() => router.push(`/operation?type=${action.action}`)}
            >
              <View style={[styles.actionIcon, { backgroundColor: action.color + '15' }]}>
                <Ionicons name={action.icon as any} size={28} color={action.color} />
              </View>
              <Text style={styles.actionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Admin Actions */}
        {user?.role === 'admin' && (
          <>
            <Text style={styles.sectionTitle}>Admin</Text>
            <TouchableOpacity
              style={styles.adminAction}
              onPress={() => router.push('/operation?type=adjust')}
            >
              <Ionicons name="construct-outline" size={24} color="#666" />
              <Text style={styles.adminActionText}>Rettifica Inventario</Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
          </>
        )}

        {/* Scan Button */}
        <TouchableOpacity
          style={styles.scanButton}
          onPress={() => router.push('/(tabs)/scan')}
        >
          <Ionicons name="barcode-outline" size={32} color="#fff" />
          <Text style={styles.scanButtonText}>Scansiona Barcode</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  logoImage: {
    width: 48,
    height: 48,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    marginBottom: 16,
    gap: 8,
  },
  noticeTextWrap: {
    flex: 1,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e3a8a',
  },
  noticeText: {
    fontSize: 12,
    color: '#1e40af',
    marginTop: 2,
  },
  noticeButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  noticeButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: '1%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginTop: 24,
    marginBottom: 12,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  actionButton: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    margin: '1%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  actionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
    marginTop: 8,
  },
  adminAction: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  adminActionText: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    marginLeft: 12,
  },
  scanButton: {
    backgroundColor: '#000',
    borderRadius: 12,
    padding: 20,
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
  },
});

