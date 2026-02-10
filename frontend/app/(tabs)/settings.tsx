import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, Modal, Platform, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { api, getApiBaseUrl } from '../../src/services/api';
import { Button } from '../../src/components/Button';
import { Location, Shelf, SyncStatus } from '../../src/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

interface Collection {
  id: string;
  title: string;
  product_ids: string[];
}

interface InventorySyncStatus {
  status: string;
  progress: number;
  total_variants: number;
  processed_variants: number;
  imported_count: number;
  estimated_time_remaining: string | null;
  error_message?: string;
  started_by?: string;
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [locations, setLocations] = useState<Location[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingNew, setSyncingNew] = useState(false);
  const [syncingCollections, setSyncingCollections] = useState(false);
  const [inventorySyncStatus, setInventorySyncStatus] = useState<InventorySyncStatus | null>(null);
  
  // Export modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'excel' | 'pdf' | 'csv'>('excel');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [exportSearch, setExportSearch] = useState('');
  const [exportSize, setExportSize] = useState('');
  const [exportInventory, setExportInventory] = useState<any[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportSelectionMode, setExportSelectionMode] = useState<'all' | 'collection' | 'custom'>('all');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const filteredExport = useCallback(() => {
    let data = exportInventory || [];
    if (exportSelectionMode === 'collection' && selectedCollection) {
      const coll = collections.find(c => c.id === selectedCollection);
      if (coll?.product_ids?.length) {
        const idSet = new Set(coll.product_ids);
        data = data.filter((i: any) => i.product_id && idSet.has(i.product_id));
      }
    }
    if (exportSize.trim()) {
      const size = exportSize.trim().toLowerCase();
      data = data.filter((i: any) => (i.variant_title || '').toLowerCase().includes(size));
    }
    if (exportSearch.trim()) {
      const q = exportSearch.trim().toLowerCase();
      data = data.filter((i: any) => {
        const hay = `${i.product_title || ''} ${i.variant_title || ''} ${i.variant_barcode || ''} ${i.variant_upc_backup || ''} ${i.variant_sku || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return data;
  }, [exportInventory, selectedCollection, exportSize, exportSearch, collections]);

  const exportGroups = useCallback(() => {
    const data = filteredExport();
    const grouped: Record<string, { product_id: string; product_title: string; variants: any[] }> = {};
    data.forEach((item: any) => {
      const pid = item.product_id || item.variant_id;
      if (!grouped[pid]) {
        grouped[pid] = { product_id: item.product_id || pid, product_title: item.product_title || 'Prodotto', variants: [] };
      }
      grouped[pid].variants.push(item);
    });
    return Object.values(grouped);
  }, [filteredExport]);

  const toggleVariantSelection = (variantId: string) => {
    setSelectedVariantIds((prev) => prev.includes(variantId) ? prev.filter((v) => v !== variantId) : [...prev, variantId]);
  };

  const toggleProductSelection = (productId: string, variants: any[]) => {
    const variantIds = variants.map((v: any) => v.variant_id).filter(Boolean);
    const allSelected = variantIds.every((v: string) => selectedVariantIds.includes(v));
    if (allSelected) {
      setSelectedVariantIds((prev) => prev.filter((v) => !variantIds.includes(v)));
    } else {
      setSelectedVariantIds((prev) => Array.from(new Set([...prev, ...variantIds])));
    }
    setSelectedProductIds((prev) => prev.includes(productId) ? prev.filter((p) => p !== productId) : [...prev, productId]);
  };
  const isWeb = Platform.OS === 'web';

  const alertProxy = (title: string, message: string, buttons?: Array<{ text: string; onPress?: () => void; style?: string }>) => {
    if (!isWeb) {
      Alert.alert(title, message, buttons as any);
      return;
    }
    if (!buttons || buttons.length === 0) {
      window.alert(`${title}\n\n${message}`);
      return;
    }
    if (buttons.length === 1) {
      window.alert(`${title}\n\n${message}`);
      if (buttons[0]?.onPress) buttons[0].onPress();
      return;
    }
    const ok = window.confirm(`${title}\n\n${message}`);
    const cancelBtn = buttons.find((b) => b.style === 'cancel');
    const confirmBtn = buttons.find((b) => b.style !== 'cancel') || buttons[buttons.length - 1];
    const chosen = ok ? confirmBtn : cancelBtn;
    if (chosen?.onPress) chosen.onPress();
  };

  const loadData = async () => {
    try {
      const [locs, shelvesData, status, colls, invSyncStatus] = await Promise.all([
        api.getLocations(),
        api.getShelves(),
        api.getSyncStatus(),
        api.getCollections().catch(() => []),
        api.getInventorySyncStatus().catch(() => null),
      ]);
      setLocations(locs);
      setShelves(shelvesData);
      setSyncStatus(status);
      setCollections(colls);
      setInventorySyncStatus(invSyncStatus);
    } catch (error) {
      console.error('Error loading settings data:', error);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Poll for Shopify sync status when running
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (syncStatus?.status === 'syncing') {
      interval = setInterval(async () => {
        try {
          const status = await api.getSyncStatus();
          setSyncStatus(status);
          if (status.status !== 'syncing' && interval) {
            clearInterval(interval);
            loadData();
          }
        } catch (e) {
          console.error('Error polling Shopify sync status:', e);
        }
      }, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [syncStatus?.status]);

  // Poll for inventory sync status when running
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    if (inventorySyncStatus?.status === 'running') {
      interval = setInterval(async () => {
        try {
          const status = await api.getInventorySyncStatus();
          setInventorySyncStatus(status);
          
          // Stop polling if completed or error
          if (status.status !== 'running') {
            if (interval) clearInterval(interval);
            loadData(); // Refresh all data
          }
        } catch (e) {
          console.error('Error polling sync status:', e);
        }
      }, 5000); // Poll every 5 seconds
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [inventorySyncStatus?.status]);

  const handleShopifySync = async () => {
    alertProxy(
      'Aggiorna Tutti i Prodotti',
      'Questa operazione aggiorna TUTTI i prodotti da Shopify, inclusi barcode e dettagli modificati. Potrebbe richiedere alcuni minuti.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Aggiorna Tutti',
          onPress: async () => {
            setSyncing(true);
            try {
              const result = await api.syncShopify();
              alertProxy('Successo', result.message);
              loadData();
            } catch (error: any) {
              alertProxy('Errore', error.response?.data?.detail || 'Errore durante la sincronizzazione');
            } finally {
              setSyncing(false);
            }
          },
        },
      ]
    );
  };

  const handleSyncNewProducts = async () => {
    alertProxy(
      'Sincronizza Nuovi Prodotti',
      'Questa operazione importa solo i NUOVI prodotti creati su Shopify che non esistono ancora nel gestionale.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Importa Nuovi',
          onPress: async () => {
            setSyncingNew(true);
            try {
              const result = await api.syncNewProducts();
              alertProxy('Successo', result.message);
              loadData();
            } catch (error: any) {
              alertProxy('Errore', error.response?.data?.detail || 'Errore durante la sincronizzazione');
            } finally {
              setSyncingNew(false);
            }
          },
        },
      ]
    );
  };

  const handleSyncCollections = async () => {
    alertProxy(
      'Sincronizza Collections',
      'Vuoi sincronizzare le collections da Shopify?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Sincronizza',
          onPress: async () => {
            setSyncingCollections(true);
            try {
              await api.syncShopifyCollections();
              alertProxy('Successo', 'Collections sincronizzate');
              loadData();
            } catch (error: any) {
              alertProxy('Errore', error.response?.data?.detail || 'Errore durante la sincronizzazione');
            } finally {
              setSyncingCollections(false);
            }
          },
        },
      ]
    );
  };

  const handleSyncInventory = async () => {
    // Check if already running
    if (inventorySyncStatus?.status === 'running') {
      alertProxy('Info', 'Sincronizzazione già in corso. Attendi il completamento.');
      return;
    }

    alertProxy(
      '⚠️ Sincronizza Inventario da Shopify',
      'ATTENZIONE: Questa operazione cancellerà TUTTO l\'inventario locale e importerà le quantità da Shopify.\n\nLa sincronizzazione proseguirà in background anche se chiudi l\'app.\n\nTempo stimato: ~3 secondi per variante.\n\nContinuare?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Sì, Avvia',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await api.syncInventoryFromShopify();
              alertProxy('Avviata!', result.message || 'Sincronizzazione avviata in background. Puoi controllare lo stato in questa pagina.');
              loadData();
            } catch (error: any) {
              alertProxy('Errore', error.response?.data?.detail || 'Errore durante l\'avvio della sincronizzazione');
            }
          },
        },
      ]
    );
  };

  const handleStopSync = async () => {
    alertProxy(
      'Interrompi Sincronizzazione',
      'Vuoi interrompere la sincronizzazione inventario?',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sì, Interrompi',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.stopInventorySync();
              loadData();
            } catch (error: any) {
              alertProxy('Errore', error.response?.data?.detail || 'Errore');
            }
          },
        },
      ]
    );
  };

  const openExportModal = (format: 'excel' | 'pdf' | 'csv') => {
    setExportFormat(format);
    setSelectedLocation(null);
    setSelectedCollection(null);
    setExportSearch('');
    setExportSize('');
    setExportSelectionMode('all');
    setSelectedProductIds([]);
    setSelectedVariantIds([]);
    setShowExportModal(true);
  };

  const loadExportInventory = async (locationId?: string | null) => {
    try {
      setExportLoading(true);
      const data = await api.getInventorySummary(locationId || undefined);
      setExportInventory(data || []);
    } catch (error) {
      setExportInventory([]);
    } finally {
      setExportLoading(false);
    }
  };

  useEffect(() => {
    if (showExportModal) {
      loadExportInventory(selectedLocation);
    }
  }, [showExportModal, selectedLocation]);

  const handleExport = async () => {
    try {
      const token = await AsyncStorage.getItem('auth_token');
      if (exportSelectionMode === 'collection' && !selectedCollection) {
        alertProxy('Errore', 'Seleziona una collection');
        return;
      }
      const productIds = exportSelectionMode === 'custom' ? selectedProductIds : undefined;
      const variantIds = exportSelectionMode === 'custom' ? selectedVariantIds : undefined;
      const collectionId = exportSelectionMode === 'collection' ? selectedCollection || undefined : selectedCollection || undefined;
      let url = exportFormat === 'excel' 
        ? api.getExportExcelUrl(selectedLocation || undefined, collectionId, exportSearch.trim() || undefined, exportSize.trim() || undefined, productIds, variantIds)
        : exportFormat === 'csv'
          ? api.getExportCsvUrl(selectedLocation || undefined, collectionId, exportSearch.trim() || undefined, exportSize.trim() || undefined, productIds, variantIds)
          : api.getExportPdfUrl(selectedLocation || undefined, collectionId, exportSearch.trim() || undefined, exportSize.trim() || undefined, productIds, variantIds);
      
      // Add token for auth
      if (token) {
        url += (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
      }
      
      setShowExportModal(false);
      if (isWeb) {
        if (!token) {
          alertProxy('Errore', 'Sessione scaduta. Effettua di nuovo il login.');
          return;
        }
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) {
          let message = `Errore HTTP ${response.status}`;
          try {
            const data = await response.json();
            message = data?.detail || message;
          } catch {
            // ignore
          }
          throw new Error(message);
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = exportFormat === 'excel'
          ? 'inventory_export.xlsx'
          : exportFormat === 'csv'
            ? 'inventory_export.csv'
            : 'catalog_export.pdf';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
      } else {
        Linking.openURL(url);
      }
    } catch (error) {
      alertProxy('Errore', error instanceof Error ? error.message : 'Impossibile esportare');
    }
  };

  const handleLogout = () => {
    alertProxy(
      'Logout',
      'Sei sicuro di voler uscire?',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Esci',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/login');
          },
        },
      ]
    );
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Mai';
    return new Date(dateStr).toLocaleString('it-IT');
  };

  const handleClearCache = async () => {
    alertProxy(
      'Svuota Cache',
      'Vuoi svuotare la cache locale e ricaricare i dati? Potresti dover rifare il login.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Svuota',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.clear();
            await loadData();
            alertProxy('Cache svuotata', 'Riapri la pagina prodotti per ricaricare tutto.');
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Impostazioni</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* User Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.card}>
            <View style={styles.userRow}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={24} color="#fff" />
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.username}>{user?.username}</Text>
                <Text style={styles.userRole}>{user?.role === 'admin' ? 'Amministratore' : 'Operatore'}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Admin Section */}
        {user?.role === 'admin' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Gestione</Text>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/admin')}
            >
              <Ionicons name="settings-outline" size={22} color="#000" />
              <Text style={styles.menuItemText}>Gestione Location e Scaffali</Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/users-management')}
            >
              <Ionicons name="people-outline" size={22} color="#000" />
              <Text style={styles.menuItemText}>Utenti, Log e Rollback</Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/pending-orders')}
            >
              <Ionicons name="cube-outline" size={22} color="#f59e0b" />
              <Text style={styles.menuItemText}>Ordini da Spedire (Shopify)</Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/purchases')}
            >
              <Ionicons name="receipt-outline" size={22} color="#22c55e" />
              <Text style={styles.menuItemText}>Acquisti da Fornitore</Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => router.push('/identita')}
              >
                <Ionicons name="id-card-outline" size={22} color="#0f766e" />
                <Text style={styles.menuItemText}>Identita Fornitori</Text>
                <Ionicons name="chevron-forward" size={20} color="#999" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => router.push('/local-products')}
              >
                <Ionicons name="cloud-upload-outline" size={22} color="#111827" />
                <Text style={styles.menuItemText}>Prodotti Locali (Push Shopify)</Text>
                <Ionicons name="chevron-forward" size={20} color="#999" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => router.push('/create-product')}
              >
              <Ionicons name="add-circle-outline" size={22} color="#3b82f6" />
              <Text style={styles.menuItemText}>Crea Prodotto Locale</Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/caricaprodottionline')}
            >
              <Ionicons name="cloud-upload-outline" size={22} color="#111827" />
              <Text style={styles.menuItemText}>Carica Prodotti Online</Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
          </View>
        )}

        {/* Shopify Sync */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Shopify</Text>
          <View style={styles.card}>
            <View style={styles.syncInfo}>
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}>Stato:</Text>
                <View style={[
                  styles.syncBadge,
                  syncStatus?.status === 'completed' && styles.syncBadgeSuccess,
                  syncStatus?.status === 'error' && styles.syncBadgeError,
                ]}>
                  <Text style={styles.syncBadgeText}>
                    {syncStatus?.status === 'never_synced' ? 'Mai sincronizzato' :
                     syncStatus?.status === 'syncing' ? 'In corso...' :
                     syncStatus?.status === 'completed' ? 'Completato' :
                     syncStatus?.status === 'error' ? 'Errore' : 'Sconosciuto'}
                  </Text>
                </View>
              </View>
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}>Prodotti sincronizzati:</Text>
                <Text style={styles.syncValue}>{syncStatus?.products_synced || 0}</Text>
              </View>
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}>Nuovi:</Text>
                <Text style={styles.syncValue}>{syncStatus?.products_created || 0}</Text>
              </View>
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}>Aggiornati:</Text>
                <Text style={styles.syncValue}>{syncStatus?.products_updated || 0}</Text>
              </View>
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}>Collections:</Text>
                <Text style={styles.syncValue}>{collections.length}</Text>
              </View>
              <View style={styles.syncRow}>
                <Text style={styles.syncLabel}>Ultima sincronizzazione:</Text>
                <Text style={styles.syncValue}>{formatDate(syncStatus?.last_sync_at)}</Text>
              </View>
              {syncStatus?.last_started_at && (
                <View style={styles.syncRow}>
                  <Text style={styles.syncLabel}>Avviata:</Text>
                  <Text style={styles.syncValue}>{formatDate(syncStatus?.last_started_at)}</Text>
                </View>
              )}
              {syncStatus?.error_message && (
                <Text style={styles.syncError}>{syncStatus.error_message}</Text>
              )}
            </View>
            
            {user?.role === 'admin' && (
              <>
                <Button
                  title={syncing ? 'Aggiornamento...' : 'Aggiorna Tutti i Prodotti'}
                  onPress={handleShopifySync}
                  loading={syncing}
                  disabled={syncing || syncingNew}
                  style={{ marginTop: 16 }}
                />
                <Button
                  title={syncingNew ? 'Importazione...' : 'Sincronizza Solo Nuovi'}
                  onPress={handleSyncNewProducts}
                  loading={syncingNew}
                  disabled={syncing || syncingNew}
                  variant="outline"
                  style={{ marginTop: 8 }}
                />
                <Button
                  title={syncingCollections ? 'Sincronizzazione...' : 'Sincronizza Collections'}
                  onPress={handleSyncCollections}
                  loading={syncingCollections}
                  disabled={syncingCollections}
                  variant="outline"
                  style={{ marginTop: 8 }}
                />
                
                {/* Inventory Sync Section */}
                <View style={styles.inventorySyncSection}>
                  <Text style={styles.inventorySyncTitle}>Sincronizzazione Inventario</Text>
                  
                  {inventorySyncStatus?.status === 'running' ? (
                    <View style={styles.syncProgressContainer}>
                      <View style={styles.progressBarBg}>
                        <View style={[styles.progressBarFill, { width: `${inventorySyncStatus.progress || 0}%` }]} />
                      </View>
                      <Text style={styles.progressText}>
                        {inventorySyncStatus.progress || 0}% - {inventorySyncStatus.processed_variants || 0}/{inventorySyncStatus.total_variants || 0} varianti
                      </Text>
                      <Text style={styles.progressSubtext}>
                        {inventorySyncStatus.imported_count || 0} prodotti con quantità importati
                      </Text>
                      {inventorySyncStatus.estimated_time_remaining && (
                        <Text style={styles.etaText}>
                          ⏱️ Tempo rimanente: {inventorySyncStatus.estimated_time_remaining}
                        </Text>
                      )}
                      <TouchableOpacity style={styles.stopButton} onPress={handleStopSync}>
                        <Ionicons name="stop-circle" size={18} color="#dc2626" />
                        <Text style={styles.stopButtonText}>Interrompi</Text>
                      </TouchableOpacity>
                    </View>
                  ) : inventorySyncStatus?.status === 'completed' ? (
                    <View style={styles.syncCompletedContainer}>
                      <Ionicons name="checkmark-circle" size={24} color="#22c55e" />
                      <Text style={styles.syncCompletedText}>
                        Completato: {inventorySyncStatus.imported_count || 0} prodotti importati
                      </Text>
                      <Button
                        title="Avvia Nuova Sync"
                        onPress={handleSyncInventory}
                        variant="outline"
                        style={{ marginTop: 12 }}
                      />
                    </View>
                  ) : (
                    <View>
                      {inventorySyncStatus?.status === 'error' && (
                        <Text style={styles.syncError}>Errore: {inventorySyncStatus.error_message}</Text>
                      )}
                      <Button
                        title="⚠️ Sincronizza Inventario da Shopify"
                        onPress={handleSyncInventory}
                        variant="outline"
                        style={{ marginTop: 8, borderColor: '#f59e0b' }}
                      />
                    </View>
                  )}
                </View>
              </>
            )}
            {user?.role !== 'admin' && (
              <Text style={styles.adminNote}>Solo gli admin possono sincronizzare</Text>
            )}
          </View>
        </View>

        {/* Export */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Esporta Catalogo</Text>
          <View style={styles.card}>
            <Text style={styles.exportDesc}>
              Esporta l'inventario come catalogo con immagini, titoli, barcode, taglie e quantità.
              Puoi filtrare per location o collezione.
            </Text>
            <View style={styles.exportButtons}>
              <Button
                title="Excel"
                onPress={() => openExportModal('excel')}
                variant="outline"
                style={{ flex: 1, marginRight: 8 }}
              />
              <Button
                title="CSV"
                onPress={() => openExportModal('csv')}
                variant="outline"
                style={{ flex: 1, marginRight: 8 }}
              />
              <Button
                title="PDF"
                onPress={() => openExportModal('pdf')}
                variant="outline"
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>

        {/* Locations & Shelves */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Location ({locations.length})</Text>
          <View style={styles.card}>
            {locations.map((loc) => (
              <View key={loc.id} style={styles.locationItem}>
                <Ionicons name="location-outline" size={20} color="#666" />
                <Text style={styles.locationName}>{loc.name}</Text>
                <Text style={styles.locationShelves}>
                  {shelves.filter(s => s.location_id === loc.id).length} scaffali
                </Text>
              </View>
            ))}
            {locations.length === 0 && (
              <Text style={styles.emptyText}>Nessuna location configurata</Text>
            )}
          </View>
        </View>

        {/* Collections */}
        {collections.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Collections ({collections.length})</Text>
            <View style={styles.card}>
              {collections.map((coll) => (
                <View key={coll.id} style={styles.locationItem}>
                  <Ionicons name="folder-outline" size={20} color="#666" />
                  <Text style={styles.locationName}>{coll.title}</Text>
                  <Text style={styles.locationShelves}>
                    {coll.product_ids?.length || 0} prodotti
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* App Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Info App</Text>
          <View style={styles.card}>
            <Text style={styles.infoLine}>
              Versione: {Constants.expoConfig?.version || Constants.nativeAppVersion || 'n/a'}
            </Text>
            <Text style={styles.infoLine}>
              Build: {String(Constants.expoConfig?.android?.versionCode || Constants.nativeBuildVersion || 'n/a')}
            </Text>
            <Text style={styles.infoLine}>
              Runtime: {String(Constants.runtimeVersion || Constants.expoConfig?.runtimeVersion || 'n/a')}
            </Text>
            <Text style={styles.infoLine}>
              Backend: {getApiBaseUrl() || 'n/a'}
            </Text>
            <Text style={styles.infoLine}>
              Project ID: {Constants.expoConfig?.extra?.eas?.projectId || 'n/a'}
            </Text>
            <TouchableOpacity style={styles.menuItem} onPress={handleClearCache}>
              <Ionicons name="trash-outline" size={22} color="#ef4444" />
              <Text style={styles.menuItemText}>Svuota cache locale</Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Logout */}
        <View style={styles.section}>
          <Button
            title="Esci"
            onPress={handleLogout}
            variant="danger"
          />
        </View>

        <Text style={styles.version}>SharkDrop WMS v1.0.0</Text>
      </ScrollView>

      {/* Export Modal */}
      <Modal
        visible={showExportModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowExportModal(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top + 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowExportModal(false)}>
              <Text style={styles.modalCancel}>Annulla</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              Esporta {exportFormat === 'excel' ? 'Excel' : exportFormat === 'csv' ? 'CSV' : 'PDF'}
            </Text>
            <TouchableOpacity onPress={handleExport}>
              <Text style={styles.modalSave}>Esporta</Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalContent}>
            {/* Location Filter */}
            <Text style={styles.filterLabel}>Filtra per Location</Text>
            <View style={styles.filterOptions}>
              <TouchableOpacity
                style={[styles.filterOption, !selectedLocation && styles.filterOptionActive]}
                onPress={() => setSelectedLocation(null)}
              >
                <Text style={[styles.filterOptionText, !selectedLocation && styles.filterOptionTextActive]}>
                  Tutte
                </Text>
              </TouchableOpacity>
              {locations.map((loc) => (
                <TouchableOpacity
                  key={loc.id}
                  style={[styles.filterOption, selectedLocation === loc.id && styles.filterOptionActive]}
                  onPress={() => setSelectedLocation(loc.id)}
                >
                  <Text style={[styles.filterOptionText, selectedLocation === loc.id && styles.filterOptionTextActive]}>
                    {loc.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Collection Filter */}
            {collections.length > 0 && (
              <>
                <Text style={styles.filterLabel}>Filtra per Collection</Text>
                <View style={styles.filterOptions}>
                  <TouchableOpacity
                    style={[styles.filterOption, !selectedCollection && styles.filterOptionActive]}
                    onPress={() => setSelectedCollection(null)}
                  >
                    <Text style={[styles.filterOptionText, !selectedCollection && styles.filterOptionTextActive]}>
                      Tutte
                    </Text>
                  </TouchableOpacity>
                  {collections.map((coll) => (
                    <TouchableOpacity
                      key={coll.id}
                      style={[styles.filterOption, selectedCollection === coll.id && styles.filterOptionActive]}
                      onPress={() => setSelectedCollection(coll.id)}
                    >
                      <Text style={[styles.filterOptionText, selectedCollection === coll.id && styles.filterOptionTextActive]}>
                        {coll.title}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.filterLabel}>Selezione Export</Text>
            <View style={styles.filterOptions}>
              <TouchableOpacity
                style={[styles.filterOption, exportSelectionMode === 'all' && styles.filterOptionActive]}
                onPress={() => setExportSelectionMode('all')}
              >
                <Text style={[styles.filterOptionText, exportSelectionMode === 'all' && styles.filterOptionTextActive]}>
                  Tutti i prodotti
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterOption, exportSelectionMode === 'collection' && styles.filterOptionActive]}
                onPress={() => setExportSelectionMode('collection')}
              >
                <Text style={[styles.filterOptionText, exportSelectionMode === 'collection' && styles.filterOptionTextActive]}>
                  Solo collection
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterOption, exportSelectionMode === 'custom' && styles.filterOptionActive]}
                onPress={() => setExportSelectionMode('custom')}
              >
                <Text style={[styles.filterOptionText, exportSelectionMode === 'custom' && styles.filterOptionTextActive]}>
                  Selezione manuale
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.filterLabel}>Cerca / Filtra Taglia</Text>
            <View style={styles.filterRow}>
              <TextInput
                style={styles.filterInput}
                placeholder="Cerca prodotto o barcode..."
                value={exportSearch}
                onChangeText={setExportSearch}
              />
              <TextInput
                style={styles.filterInput}
                placeholder="Taglia (es. 42)"
                value={exportSize}
                onChangeText={setExportSize}
              />
            </View>

            <Text style={styles.filterLabel}>Anteprima prodotti ({filteredExport().length})</Text>
            <View style={styles.previewList}>
              {exportLoading ? (
                <Text style={styles.previewEmpty}>Caricamento...</Text>
              ) : filteredExport().length === 0 ? (
                <Text style={styles.previewEmpty}>Nessun prodotto trovato</Text>
              ) : exportSelectionMode !== 'custom' ? (
                filteredExport().slice(0, 80).map((item: any) => (
                  <View key={item.id} style={styles.previewItem}>
                    <View style={styles.previewInfo}>
                      <Text style={styles.previewTitle}>{item.product_title || 'Prodotto'}</Text>
                      <Text style={styles.previewMeta}>
                        {item.variant_title || 'Variante'} • {item.location_name || 'N/A'} {item.shelf_name ? `/ ${item.shelf_name}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.previewQty}>{item.quantity || 0} pz</Text>
                  </View>
                ))
              ) : (
                exportGroups().slice(0, 60).map((group: any) => (
                  <View key={group.product_id} style={styles.previewGroup}>
                    <View style={styles.previewGroupHeader}>
                      <Text style={styles.previewTitle}>{group.product_title}</Text>
                      <TouchableOpacity onPress={() => toggleProductSelection(group.product_id, group.variants)}>
                        <Text style={styles.previewSelectAll}>Seleziona tutte le taglie</Text>
                      </TouchableOpacity>
                    </View>
                    {group.variants.map((v: any) => (
                      <TouchableOpacity key={v.id} style={styles.previewItem} onPress={() => toggleVariantSelection(v.variant_id)}>
                        <View style={styles.previewInfo}>
                          <Text style={styles.previewMeta}>
                            {v.variant_title || 'Variante'} • {v.location_name || 'N/A'} {v.shelf_name ? `/ ${v.shelf_name}` : ''}
                          </Text>
                        </View>
                        <Text style={[styles.previewQty, selectedVariantIds.includes(v.variant_id) && styles.previewQtyActive]}>
                          {selectedVariantIds.includes(v.variant_id) ? 'Selezionato' : `${v.quantity || 0} pz`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))
              )}
            </View>

            <View style={styles.exportInfo}>
              <Ionicons name="information-circle-outline" size={20} color="#666" />
              <Text style={styles.exportInfoText}>
                L'export includerà solo i prodotti con inventario disponibile.
              </Text>
            </View>
          </ScrollView>
        </View>
      </Modal>
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
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  menuItem: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    marginLeft: 12,
  },
  infoLine: {
    fontSize: 13,
    color: '#111',
    marginBottom: 6,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: {
    marginLeft: 12,
  },
  username: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  userRole: {
    fontSize: 14,
    color: '#666',
  },
  syncInfo: {
    gap: 8,
  },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  syncLabel: {
    fontSize: 14,
    color: '#666',
  },
  syncValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
  },
  syncBadge: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  syncBadgeSuccess: {
    backgroundColor: '#dcfce7',
  },
  syncBadgeError: {
    backgroundColor: '#fee2e2',
  },
  syncBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#000',
  },
  syncError: {
    fontSize: 12,
    color: '#dc2626',
    marginTop: 8,
  },
  adminNote: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
  },
  exportDesc: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  exportButtons: {
    flexDirection: 'row',
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  locationName: {
    flex: 1,
    marginLeft: 8,
    fontSize: 16,
    color: '#000',
  },
  locationShelves: {
    fontSize: 12,
    color: '#999',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 8,
  },
  version: {
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
    marginTop: 16,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  modalCancel: {
    fontSize: 16,
    color: '#666',
  },
  modalSave: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2563eb',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
    marginTop: 8,
  },
  filterOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  filterInput: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    fontSize: 14,
  },
  filterOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  filterOptionActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  filterOptionText: {
    fontSize: 14,
    color: '#000',
    fontWeight: '500',
  },
  filterOptionTextActive: {
    color: '#fff',
  },
  exportInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  exportInfoText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: '#666',
  },
  previewList: {
    backgroundColor: '#fafafa',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    padding: 10,
    marginBottom: 12,
  },
  previewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  previewGroup: {
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 6,
  },
  previewGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  previewSelectAll: {
    fontSize: 11,
    color: '#2563eb',
    fontWeight: '600',
  },
  previewInfo: {
    flex: 1,
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  previewMeta: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  previewQty: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111',
  },
  previewQtyActive: {
    color: '#16a34a',
  },
  previewEmpty: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 8,
  },
  // Inventory Sync Styles
  inventorySyncSection: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fbbf24',
  },
  inventorySyncTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#92400e',
    marginBottom: 12,
  },
  syncProgressContainer: {
    alignItems: 'center',
  },
  progressBarBg: {
    width: '100%',
    height: 12,
    backgroundColor: '#e5e7eb',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 6,
  },
  progressText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  progressSubtext: {
    marginTop: 4,
    fontSize: 12,
    color: '#666',
  },
  etaText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '500',
    color: '#f59e0b',
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    gap: 6,
  },
  stopButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#dc2626',
  },
  syncCompletedContainer: {
    alignItems: 'center',
  },
  syncCompletedText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '500',
    color: '#22c55e',
  },
});
