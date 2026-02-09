import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../../src/services/api';

type Period = 'today' | 'yesterday' | 'date' | 'month' | 'all';

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<any>(null);
  const [sales, setSales] = useState<any[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [period, setPeriod] = useState<Period>('today');
  const [date, setDate] = useState('');
  const [month, setMonth] = useState('');
  const [loading, setLoading] = useState(false);

  const loadSummary = async () => {
    try {
      const data = await api.getAnalyticsSummary();
      setSummary(data);
    } catch (e) {
      setSummary(null);
    }
  };

  const loadSales = async () => {
    setLoading(true);
    try {
      let res;
      if (period === 'today') {
        const d = new Date();
        const iso = d.toISOString().slice(0, 10);
        res = await api.getSales(iso);
      } else if (period === 'yesterday') {
        const d = new Date(Date.now() - 86400000);
        const iso = d.toISOString().slice(0, 10);
        res = await api.getSales(iso);
      } else if (period === 'date' && date) {
        res = await api.getSales(date);
      } else if (period === 'month' && month) {
        res = await api.getSales(undefined, month);
      } else {
        res = await api.getSales();
      }
      setSales(res.sales || []);
      setSalesTotal(res.total || 0);
    } catch (e) {
      setSales([]);
      setSalesTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    loadSales();
  }, [period]);

  const weekly = summary?.weekly || [];
  const maxWeekly = useMemo(() => Math.max(1, ...weekly.map((w: any) => w.sales_amount || 0)), [weekly]);

  const handleExportCsv = async () => {
    const token = await AsyncStorage.getItem('auth_token');
    let url = api.getSalesCsvUrl(
      period === 'date' ? date : undefined,
      period === 'month' ? month : undefined,
      undefined,
      undefined
    );
    if (token) {
      url += (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      Linking.openURL(url);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Analytics</Text>
        <Text style={styles.subtitle}>Vendite, ricezioni e trend</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.cardsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Ricevuti oggi</Text>
            <Text style={styles.statValue}>{summary?.received_today || 0}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Venduti oggi</Text>
            <Text style={styles.statValue}>{summary?.sold_today || 0}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Totale venduto</Text>
            <Text style={styles.statValue}>€{(summary?.revenue_today || 0).toFixed(2)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Andamento settimanale</Text>
        <View style={styles.chartCard}>
          {weekly.map((w: any) => (
            <View key={w.date} style={styles.chartRow}>
              <Text style={styles.chartLabel}>{w.date.slice(5)}</Text>
              <View style={styles.chartBarWrap}>
                <View style={[styles.chartBar, { width: `${(w.sales_amount || 0) / maxWeekly * 100}%` }]} />
              </View>
              <Text style={styles.chartValue}>€{(w.sales_amount || 0).toFixed(0)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Vendite</Text>
        <View style={styles.filtersRow}>
          {(['today','yesterday','date','month','all'] as Period[]).map((p) => (
            <TouchableOpacity key={p} style={[styles.filterChip, period === p && styles.filterChipActive]} onPress={() => setPeriod(p)}>
              <Text style={[styles.filterText, period === p && styles.filterTextActive]}>
                {p === 'today' ? 'Oggi' : p === 'yesterday' ? 'Ieri' : p === 'date' ? 'Data' : p === 'month' ? 'Mese' : 'Tutto'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {period === 'date' && (
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            value={date}
            onChangeText={setDate}
          />
        )}
        {period === 'month' && (
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM"
            value={month}
            onChangeText={setMonth}
          />
        )}

        <View style={styles.exportRow}>
          <TouchableOpacity style={styles.exportBtn} onPress={loadSales}>
            <Ionicons name="refresh" size={16} color="#111" />
            <Text style={styles.exportText}>Aggiorna</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.exportBtn, styles.exportBtnPrimary]} onPress={handleExportCsv}>
            <Ionicons name="download-outline" size={16} color="#fff" />
            <Text style={[styles.exportText, styles.exportTextPrimary]}>Esporta CSV</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.salesList}>
          <Text style={styles.salesCount}>{loading ? 'Caricamento...' : `${salesTotal} vendite`}</Text>
          {sales.map((s) => (
            <View key={s.id} style={styles.saleItem}>
              <View style={styles.saleInfo}>
                <Text style={styles.saleTitle}>{s.product_title || 'Prodotto'}</Text>
                <Text style={styles.saleMeta}>
                  {s.variant_title || 'Variante'} • {new Date(s.created_at).toLocaleString('it-IT')}
                </Text>
              </View>
              <View style={styles.saleAmount}>
                <Text style={styles.saleQty}>x{s.quantity}</Text>
                <Text style={styles.salePrice}>€{(s.total_amount || 0).toFixed(2)}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { backgroundColor: '#fff', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#e0e0e0' },
  title: { fontSize: 24, fontWeight: '700', color: '#000' },
  subtitle: { fontSize: 13, color: '#666', marginTop: 4 },
  content: { flex: 1, padding: 16 },
  cardsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { flex: 1, minWidth: 100, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e0e0e0' },
  statLabel: { fontSize: 12, color: '#666' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#000', marginTop: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#000', marginTop: 20, marginBottom: 10 },
  chartCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e0e0e0' },
  chartRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  chartLabel: { width: 40, fontSize: 11, color: '#666' },
  chartBarWrap: { flex: 1, height: 8, backgroundColor: '#f0f0f0', borderRadius: 4, marginHorizontal: 8 },
  chartBar: { height: 8, backgroundColor: '#22c55e', borderRadius: 4 },
  chartValue: { width: 60, fontSize: 11, color: '#111', textAlign: 'right' },
  filtersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e0e0e0' },
  filterChipActive: { backgroundColor: '#000', borderColor: '#000' },
  filterText: { fontSize: 12, color: '#000' },
  filterTextActive: { color: '#fff' },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#e0e0e0', marginBottom: 10 },
  exportRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e0e0e0' },
  exportBtnPrimary: { backgroundColor: '#000', borderColor: '#000' },
  exportText: { fontSize: 12, fontWeight: '600', color: '#111' },
  exportTextPrimary: { color: '#fff' },
  salesList: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e0e0e0' },
  salesCount: { fontSize: 12, color: '#666', marginBottom: 8 },
  saleItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  saleInfo: { flex: 1 },
  saleTitle: { fontSize: 13, fontWeight: '600', color: '#111' },
  saleMeta: { fontSize: 11, color: '#666', marginTop: 2 },
  saleAmount: { alignItems: 'flex-end' },
  saleQty: { fontSize: 11, color: '#666' },
  salePrice: { fontSize: 13, fontWeight: '700', color: '#111' },
});
