import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Modal, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/services/api';

interface LocalVariant {
  id: string;
  title: string;
  sku?: string;
  barcode?: string;
  price?: number;
}

interface LocalProduct {
  id: string;
  title: string;
  image_base64?: string;
  image_url?: string;
  tags?: string[];
  variants?: LocalVariant[];
  created_at?: string;
  updated_at?: string;
}

export default function LocalProductsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<LocalProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [selected, setSelected] = useState<LocalProduct | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const [usedTag, setUsedTag] = useState(false);
  const [keepPhotoBg, setKeepPhotoBg] = useState(false);
  const [extraTags, setExtraTags] = useState('');
  const [pushing, setPushing] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getLocalProducts();
      setItems(res || []);
    } catch (e: any) {
      setError(e?.message || 'Errore caricamento prodotti locali');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter((p) => {
      const variants = p.variants || [];
      const hay = `${p.title || ''} ${variants.map((v) => `${v.title} ${v.sku || ''} ${v.barcode || ''}`).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  const openPush = (product: LocalProduct) => {
    setSelected(product);
    setUsedTag(false);
    setKeepPhotoBg(false);
    setExtraTags('');
    setPushOpen(true);
  };

  const confirmPush = async () => {
    if (!selected) return;
    try {
      setPushing(true);
      await api.pushLocalProduct({
        product_id: selected.id,
        used_tag: usedTag,
        keep_photo_bg: keepPhotoBg,
        extra_tags: extraTags.trim() || undefined
      });
      Alert.alert('Successo', 'Prodotto caricato su Shopify. Esegui Sync prodotti per vederlo in gestionale.');
      setPushOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('Errore', e?.response?.data?.detail || 'Errore durante push su Shopify');
    } finally {
      setPushing(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#111" />
          <Text style={styles.backText}>Indietro</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Prodotti Locali</Text>
        <Text style={styles.subtitle}>Non ancora su Shopify</Text>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color="#666" />
        <TextInput
          placeholder="Cerca titolo, barcode, sku..."
          placeholderTextColor="#999"
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
        />
        <TouchableOpacity onPress={load}>
          <Ionicons name="refresh" size={18} color="#111" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color="#111" />
          <Text style={styles.loadingText}>Caricamento...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Riprova</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {filtered.map((product) => {
            const variants = product.variants || [];
            return (
              <View key={product.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{product.title}</Text>
                    <Text style={styles.cardMeta}>{variants.length} varianti</Text>
                    {variants[0]?.barcode ? (
                      <Text style={styles.cardMeta}>Barcode: {variants[0]?.barcode}</Text>
                    ) : null}
                  </View>
                  <TouchableOpacity style={styles.pushBtn} onPress={() => openPush(product)}>
                    <Text style={styles.pushText}>Push Shopify</Text>
                  </TouchableOpacity>
                </View>
                {variants.length > 0 && (
                  <View style={styles.variantList}>
                    {variants.slice(0, 3).map((v) => (
                      <Text key={v.id} style={styles.variantRow}>
                        {v.title} {v.sku ? `• SKU ${v.sku}` : ''} {v.barcode ? `• ${v.barcode}` : ''}
                      </Text>
                    ))}
                    {variants.length > 3 && <Text style={styles.variantRow}>+{variants.length - 3} altre...</Text>}
                  </View>
                )}
              </View>
            );
          })}
          {filtered.length === 0 && (
            <Text style={styles.empty}>Nessun prodotto locale trovato.</Text>
          )}
        </ScrollView>
      )}

      <Modal visible={pushOpen} transparent animationType="fade" onRequestClose={() => setPushOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Push su Shopify</Text>
            <Text style={styles.modalSubtitle}>{selected?.title}</Text>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Aggiungi tag "used"</Text>
              <Switch value={usedTag} onValueChange={setUsedTag} />
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Mantieni foto originale</Text>
              <Switch value={keepPhotoBg} onValueChange={setKeepPhotoBg} />
            </View>

            <Text style={styles.inputLabel}>Tag extra (separati da virgola)</Text>
            <TextInput
              placeholder="es: limited, promo"
              placeholderTextColor="#aaa"
              value={extraTags}
              onChangeText={setExtraTags}
              style={styles.input}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setPushOpen(false)} disabled={pushing}>
                <Text style={styles.cancelText}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirmPush} disabled={pushing}>
                <Text style={styles.confirmText}>{pushing ? 'Caricamento...' : 'Conferma'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f6f8' },
  header: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backText: { marginLeft: 4, color: '#111', fontWeight: '600' },
  title: { fontSize: 20, fontWeight: '700', color: '#111' },
  subtitle: { marginTop: 4, color: '#666' },
  searchBox: { marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, height: 44, borderRadius: 10, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, color: '#111' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  loadingText: { marginTop: 8, color: '#666' },
  errorText: { color: '#b00020', textAlign: 'center', marginBottom: 12 },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#111' },
  retryText: { color: '#fff', fontWeight: '600' },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e8e8e8' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  cardMeta: { marginTop: 4, color: '#777', fontSize: 12 },
  pushBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#111' },
  pushText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  variantList: { marginTop: 10, gap: 4 },
  variantRow: { color: '#333', fontSize: 12 },
  empty: { color: '#777', textAlign: 'center', marginTop: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111' },
  modalSubtitle: { marginTop: 4, color: '#666', marginBottom: 12 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  toggleLabel: { color: '#111' },
  inputLabel: { marginTop: 8, color: '#666', fontSize: 12 },
  input: { marginTop: 6, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, color: '#111' },
  modalActions: { marginTop: 14, flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#eee' },
  cancelText: { color: '#333', fontWeight: '600' },
  confirmBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#111' },
  confirmText: { color: '#fff', fontWeight: '600' }
});
