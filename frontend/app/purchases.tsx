import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, getPublicWebBaseUrl } from '../src/services/api';
import { Button } from '../src/components/Button';
import { safeBack } from '../src/utils/safeBack';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface PurchaseLink {
  id: string;
  token: string;
  items: {
    title: string;
    variant_title?: string;
    quantity: number;
    purchase_price: number;
  }[];
  total_amount: number;
  note?: string;
  created_at: string;
  expires_at: string;
  status: 'pending' | 'submitted' | 'completed' | 'expired';
  doc_type?: 'acquisto' | 'contovendita';
  supplier_data?: {
    first_name: string;
    last_name: string;
    fiscal_code: string;
    birth_date: string;
    birth_place: string;
    residence_city: string;
  };
  submitted_at?: string;
}

type TabType = 'pending' | 'submitted' | 'all';

export default function PurchasesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  
  const [activeTab, setActiveTab] = useState<TabType>('submitted');
  const [purchases, setPurchases] = useState<PurchaseLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadPurchases = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getPurchaseLinks();
      setPurchases(data || []);
    } catch (error) {
      console.error('Error loading purchases:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPurchases();
  }, [loadPurchases]);

  const onRefresh = () => {
    setRefreshing(true);
    loadPurchases();
  };

  const filteredPurchases = purchases.filter(p => {
    if (activeTab === 'pending') return p.status === 'pending';
    if (activeTab === 'submitted') return p.status === 'submitted';
    return true;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#f59e0b';
      case 'submitted': return '#22c55e';
      case 'completed': return '#3b82f6';
      case 'expired': return '#dc2626';
      default: return '#666';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return 'In attesa';
      case 'submitted': return 'Compilato';
      case 'completed': return 'Completato';
      case 'expired': return 'Scaduto';
      default: return status;
    }
  };

  const formatDate = (dateStr: string) => {
};

  const getDocTypeLabel = (docType?: string) => {
    if (docType === 'contovendita') return 'Contovendita';
    return 'Acquisto';
  };

  const copyLink = async (token: string) => {
    const base = getPublicWebBaseUrl();
    if (!base) {
      Alert.alert('Errore', 'URL pubblico non configurato. Imposta EXPO_PUBLIC_WEB_URL.');
      return;
    }
    await Clipboard.setStringAsync(`${base}/acquisto/${token}`);
    Alert.alert('Copiato!', 'Link copiato negli appunti');
  };

  const downloadPdf = async (id: string) => {
    const token = await AsyncStorage.getItem('auth_token');
    let url = api.getPurchasePdfUrl(id);
    if (token) {
      url += (url.includes('?') ? '&' : '?') + `token=${token}`;
    }
    Linking.openURL(url);
  };

  const deletePurchase = async (id: string) => {
    Alert.alert(
      'Elimina Link',
      'Sei sicuro di voler eliminare questo link di acquisto?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Elimina',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deletePurchaseLink(id);
              loadPurchases();
            } catch (error: any) {
              Alert.alert('Errore', error.response?.data?.detail || 'Errore');
            }
          }
        }
      ]
    );
  };

  const pendingCount = purchases.filter(p => p.status === 'pending').length;
  const submittedCount = purchases.filter(p => p.status === 'submitted').length;

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text>Caricamento...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity onPress={() => safeBack(router)} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.title}>Acquisti da Fornitore</Text>
        <TouchableOpacity onPress={loadPurchases} style={styles.backButton}>
          <Ionicons name="refresh" size={22} color="#000" />
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'submitted' && styles.tabActive]}
          onPress={() => setActiveTab('submitted')}
        >
          <Text style={[styles.tabText, activeTab === 'submitted' && styles.tabTextActive]}>
            Da Processare ({submittedCount})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'pending' && styles.tabActive]}
          onPress={() => setActiveTab('pending')}
        >
          <Text style={[styles.tabText, activeTab === 'pending' && styles.tabTextActive]}>
            In Attesa ({pendingCount})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'all' && styles.tabActive]}
          onPress={() => setActiveTab('all')}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>
            Tutti
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {filteredPurchases.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={48} color="#ccc" />
            <Text style={styles.emptyTitle}>
              {activeTab === 'submitted' ? 'Nessun acquisto da processare' : 'Nessun link'}
            </Text>
            <Text style={styles.emptyText}>
              {activeTab === 'submitted' 
                ? "Quando un fornitore compila il form, apparira' qui"
                : 'Crea un link di acquisto per iniziare'}
            </Text>
          </View>
        ) : (
          filteredPurchases.map((purchase) => (
            <View key={purchase.id} style={styles.card}>
              <TouchableOpacity 
                style={styles.cardHeader}
                onPress={() => setExpandedId(expandedId === purchase.id ? null : purchase.id)}
              >
                <View style={styles.cardInfo}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTotal}>
                      {purchase.doc_type === 'contovendita' ? 'n/a' : `EUR ${purchase.total_amount.toFixed(2)}`}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(purchase.status) }]}>
                      <Text style={styles.statusText}>{getStatusLabel(purchase.status)}</Text>
                    </View>
                    <View style={styles.docTypeBadge}>
                      <Text style={styles.docTypeText}>{getDocTypeLabel(purchase.doc_type)}</Text>
                    </View>
                  </View>
                  <Text style={styles.cardMeta}>
                    {purchase.items.length} prodotti - {formatDate(purchase.created_at)}
                  </Text>
                  {purchase.supplier_data && (
                    <Text style={styles.supplierName}>
                      {purchase.supplier_data.first_name} {purchase.supplier_data.last_name}
                    </Text>
                  )}
                </View>
                <Ionicons 
                  name={expandedId === purchase.id ? "chevron-up" : "chevron-down"} 
                  size={20} 
                  color="#666" 
                />
              </TouchableOpacity>

              {expandedId === purchase.id && (
                <View style={styles.cardDetails}>
                  {/* Products */}
                  <Text style={styles.sectionTitle}>Prodotti:</Text>
                  {purchase.items.map((item, idx) => (
                    <View key={idx} style={styles.itemRow}>
                      <Text style={styles.itemTitle}>
                        {item.title} {item.variant_title && `(${item.variant_title})`}
                      </Text>
                      <Text style={styles.itemPrice}>
                        {item.quantity}x EUR {item.purchase_price.toFixed(2)}
                      </Text>
                    </View>
                  ))}

                  {/* Supplier Data */}
                  {purchase.supplier_data && (
                    <>
                      <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Dati Fornitore:</Text>
                      <View style={styles.supplierInfo}>
                        <Text style={styles.supplierField}>
                          <Text style={styles.supplierLabel}>Nome: </Text>
                          {purchase.supplier_data.first_name} {purchase.supplier_data.last_name}
                        </Text>
                        <Text style={styles.supplierField}>
                          <Text style={styles.supplierLabel}>Codice Fiscale: </Text>
                          {purchase.supplier_data.fiscal_code}
                        </Text>
                        <Text style={styles.supplierField}>
                          <Text style={styles.supplierLabel}>Data/Luogo Nascita: </Text>
                          {purchase.supplier_data.birth_date} - {purchase.supplier_data.birth_place}
                        </Text>
                        <Text style={styles.supplierField}>
                          <Text style={styles.supplierLabel}>Residenza: </Text>
                          {purchase.supplier_data.residence_city}
                        </Text>
                      </View>
                    </>
                  )}

                  {/* Actions */}
                  <View style={styles.cardActions}>
                    {purchase.status === 'pending' && (
                      <TouchableOpacity 
                        style={styles.actionButton}
                        onPress={() => copyLink(purchase.token)}
                      >
                        <Ionicons name="copy-outline" size={18} color="#3b82f6" />
                        <Text style={styles.actionButtonText}>Copia Link</Text>
                      </TouchableOpacity>
                    )}
                    
                    {purchase.status === 'submitted' && (
                      <TouchableOpacity 
                        style={[styles.actionButton, styles.actionButtonPrimary]}
                        onPress={() => downloadPdf(purchase.id)}
                      >
                        <Ionicons name="download-outline" size={18} color="#fff" />
                        <Text style={[styles.actionButtonText, { color: '#fff' }]}>Scarica PDF</Text>
                      </TouchableOpacity>
                    )}
                    
                    <TouchableOpacity 
                      style={[styles.actionButton, styles.actionButtonDanger]}
                      onPress={() => deletePurchase(purchase.id)}
                    >
                      <Ionicons name="trash-outline" size={18} color="#dc2626" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => router.push('/create-purchase-link')}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
    textAlign: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#000',
  },
  tabText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#000',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  docTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#0f172a',
  },
  docTypeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    textTransform: 'uppercase',
  },
  cardTotal: {
    fontSize: 20,
    fontWeight: '700',
    color: '#22c55e',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  cardMeta: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  supplierName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginTop: 4,
  },
  cardDetails: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginTop: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  itemTitle: {
    fontSize: 13,
    color: '#333',
    flex: 1,
  },
  itemPrice: {
    fontSize: 13,
    fontWeight: '500',
    color: '#000',
  },
  supplierInfo: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
  },
  supplierField: {
    fontSize: 13,
    color: '#333',
    marginBottom: 6,
  },
  supplierLabel: {
    fontWeight: '600',
    color: '#666',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    gap: 6,
  },
  actionButtonPrimary: {
    backgroundColor: '#3b82f6',
    flex: 1,
    justifyContent: 'center',
  },
  actionButtonDanger: {
    backgroundColor: '#fef2f2',
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#3b82f6',
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
    boxShadow: '0px 4px 10px rgba(0,0,0,0.25)',
  },
});



