import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/services/api';

interface IdentityItem {
  id: string;
  identity_key: string;
  created_at: string;
  updated_at: string;
  last_used_at: string;
  source_link_id?: string;
  source_doc_type?: string;
  data: Record<string, any>;
}

const formatDate = (value?: string) => {
  if (!value) return '-';
  try {
    const d = new Date(value);
    return d.toLocaleString('it-IT');
  } catch {
    return value;
  }
};

export default function IdentitaScreen() {
  const router = useRouter();
  const [items, setItems] = useState<IdentityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async (q?: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getPurchaseIdentities(q || undefined, 0, 200);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || 'Errore caricamento identita');
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
    return items.filter((it) => {
      const d = it.data || {};
      const hay = `${d.first_name || ''} ${d.last_name || ''} ${d.fiscal_code || ''} ${d.phone || ''} ${d.email || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  const copyIdentity = async (identity: IdentityItem) => {
    const d = identity.data || {};
    const text = JSON.stringify(d, null, 2);
    await Clipboard.setStringAsync(text);
    Alert.alert('Copiato', 'Dati identita copiati negli appunti');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#111" />
          <Text style={styles.backText}>Indietro</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Identita Fornitori</Text>
        <Text style={styles.subtitle}>Archivio dati da fogli di acquisto/contovendita</Text>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color="#666" />
        <TextInput
          placeholder="Cerca nome, codice fiscale, telefono..."
          placeholderTextColor="#999"
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
        />
        <TouchableOpacity onPress={() => load(query)}>
          <Ionicons name="refresh" size={18} color="#111" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color="#111" />
          <Text style={styles.loadingText}>Caricamento identita...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load(query)}>
            <Text style={styles.retryText}>Riprova</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {filtered.map((identity) => {
            const d = identity.data || {};
            const name = `${d.first_name || ''} ${d.last_name || ''}`.trim() || 'Senza nome';
            const expanded = expandedId === identity.id;
            return (
              <View key={identity.id} style={styles.card}>
                <TouchableOpacity style={styles.cardHeader} onPress={() => setExpandedId(expanded ? null : identity.id)}>
                  <View>
                    <Text style={styles.cardTitle}>{name}</Text>
                    <Text style={styles.cardSubtitle}>CF: {d.fiscal_code || 'n/a'}</Text>
                    <Text style={styles.cardMeta}>Ultimo uso: {formatDate(identity.last_used_at)}</Text>
                  </View>
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#111" />
                </TouchableOpacity>
                {expanded && (
                  <View style={styles.cardBody}>
                    <Text style={styles.row}>Nascita: {d.birth_date || '-'} - {d.birth_place || '-'} ({d.birth_country || '-'})</Text>
                    <Text style={styles.row}>Residenza: {d.residence_address || '-'}, {d.residence_city || '-'} {d.residence_province || ''} {d.residence_cap || ''}</Text>
                    <Text style={styles.row}>Telefono: {d.phone || '-'}</Text>
                    <Text style={styles.row}>Email: {d.email || '-'}</Text>
                    <Text style={styles.row}>IBAN: {d.iban || '-'}</Text>
                    <Text style={styles.row}>Documento: {identity.source_doc_type || '-'}</Text>
                    <View style={styles.actionsRow}>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => copyIdentity(identity)}>
                        <Ionicons name="copy" size={16} color="#111" />
                        <Text style={styles.actionText}>Copia dati</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
          {filtered.length === 0 && (
            <Text style={styles.empty}>Nessuna identita trovata.</Text>
          )}
        </ScrollView>
      )}
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
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  cardSubtitle: { marginTop: 2, color: '#444' },
  cardMeta: { marginTop: 4, color: '#777', fontSize: 12 },
  cardBody: { marginTop: 10, gap: 6 },
  row: { color: '#333', fontSize: 13 },
  actionsRow: { marginTop: 10, flexDirection: 'row', gap: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#f0f0f0' },
  actionText: { color: '#111', fontWeight: '600' },
  empty: { color: '#777', textAlign: 'center', marginTop: 20 }
});
