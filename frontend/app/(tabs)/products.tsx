import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity, Image, TextInput, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/services/api';
import { Product } from '../../src/types';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';

export default function ProductsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [collections, setCollections] = useState<any[]>([]);
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null);
  const [sizeFilter, setSizeFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const loadProducts = async (searchQuery?: string) => {
    try {
      const data = await api.getProducts(searchQuery || undefined);
      setProducts(data.products);
      setTotal(data.total);
    } catch (error) {
      console.error('Error loading products:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
    api.getCollections().then(setCollections).catch(() => setCollections([]));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProducts(search);
    setRefreshing(false);
  }, [search]);

  const handleSearch = () => {
    setLoading(true);
    loadProducts(search);
  };

  const matchesSearch = (p: Product) => {
    if (collectionFilter) {
      const coll = collections.find((c) => c.id === collectionFilter);
      if (coll?.product_ids?.length && !coll.product_ids.includes(p.id)) return false;
    }
    if (sizeFilter.trim()) {
      const size = sizeFilter.trim().toLowerCase();
      const has = p.variants?.some((v) => (v.title || '').toLowerCase().includes(size));
      if (!has) return false;
    }
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const hay = `${p.title || ''} ${(p.variants || []).map(v => `${v.title} ${v.barcode || ''} ${v.sku || ''}`).join(' ')}`.toLowerCase();
    const allTokens = tokens.every(t => hay.includes(t));
    if (allTokens) return true;
    const compactHay = hay.replace(/[^a-z0-9]/g, '');
    const compactQ = q.replace(/[^a-z0-9]/g, '');
    return compactQ.length > 2 && compactHay.includes(compactQ);
  };

  const filteredProducts = products.filter(matchesSearch);

  const renderProduct = ({ item }: { item: Product }) => (
    <TouchableOpacity 
      style={styles.productCard}
      onPress={() => router.push(`/product-detail?id=${item.id}`)}
    >
      <View style={styles.imageContainer}>
        {item.image_base64 || item.image_url ? (
          <Image
            source={{ uri: item.image_base64 || item.image_url }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="image-outline" size={24} color="#ccc" />
          </View>
        )}
      </View>
      <View style={styles.productInfo}>
        <Text style={styles.productTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.variantCount}>{item.variants?.length || 0} varianti</Text>
        <View style={styles.variantsList}>
          {item.variants?.slice(0, 5).map((v, i) => (
            <View key={i} style={styles.variantChip}>
              <Text style={styles.variantChipText}>{v.title}</Text>
            </View>
          ))}
          {item.variants?.length > 5 && (
            <Text style={styles.moreVariants}>+{item.variants.length - 5}</Text>
          )}
        </View>
        <View style={styles.productActions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push(`/product-detail?id=${item.id}`)}>
            <Text style={styles.actionText}>Modifica</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              const firstVariant = item.variants?.[0];
              const variantParam = firstVariant ? `&variant_id=${firstVariant.id}` : '';
              router.push(`/operation?type=receive&product_id=${item.id}${variantParam}`);
            }}
          >
            <Text style={styles.actionText}>Ricevi</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color="#ccc" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Prodotti</Text>
        <Text style={styles.subtitle}>{total} prodotti nel catalogo</Text>
      </View>

      <View style={styles.quickActions}>
        <TouchableOpacity style={styles.quickButton} onPress={() => router.push('/operation?type=receive')}>
          <Ionicons name="add-circle-outline" size={18} color="#111" />
          <Text style={styles.quickButtonText}>Ricevi rapido</Text>
        </TouchableOpacity>
      </View>

      {/* Search + Filters */}
      <View style={styles.searchRow}>
        <View style={styles.searchInput}>
          <Ionicons name="search" size={18} color="#999" />
          <TextInput
            style={styles.searchText}
            placeholder="Cerca prodotto o barcode..."
            value={search}
            onChangeText={(v) => {
              setSearch(v);
            }}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            placeholderTextColor="#999"
          />
          <TouchableOpacity onPress={() => setShowScanner(true)}>
            <Ionicons name="barcode-outline" size={20} color="#111" />
          </TouchableOpacity>
          {search ? (
            <TouchableOpacity onPress={() => { setSearch(''); loadProducts(); }}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setShowFilters(true)}>
          <Ionicons name="options-outline" size={18} color="#111" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredProducts}
        keyExtractor={(item) => item.id}
        renderItem={renderProduct}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="pricetags-outline" size={64} color="#ccc" />
            <Text style={styles.emptyText}>Nessun prodotto</Text>
            <Text style={styles.emptyHint}>Sincronizza con Shopify per importare i prodotti</Text>
          </View>
        }
      />

      <Modal visible={showFilters} animationType="slide" transparent onRequestClose={() => setShowFilters(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Filtri Prodotti</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Taglia (es. 42, M)"
              value={sizeFilter}
              onChangeText={setSizeFilter}
            />
            {collections.length > 0 && (
              <>
                <Text style={styles.modalLabel}>Collection</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.modalScroll}>
                  <View style={styles.modalOptions}>
                    <TouchableOpacity
                      style={[styles.optionChip, !collectionFilter && styles.optionChipActive]}
                      onPress={() => setCollectionFilter(null)}
                    >
                      <Text style={[styles.optionText, !collectionFilter && styles.optionTextActive]}>Tutte</Text>
                    </TouchableOpacity>
                    {collections.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.optionChip, collectionFilter === c.id && styles.optionChipActive]}
                        onPress={() => setCollectionFilter(c.id)}
                      >
                        <Text style={[styles.optionText, collectionFilter === c.id && styles.optionTextActive]}>
                          {c.title}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => {
                setSizeFilter('');
                setCollectionFilter(null);
              }}>
                <Text style={styles.modalBtnText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={() => setShowFilters(false)}>
                <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>Applica</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <BarcodeScanner
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={(code) => {
          setSearch(code);
          loadProducts(code);
        }}
        title="Scansiona Barcode"
      />
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
  quickActions: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  quickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#f8f8f8',
  },
  quickButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchText: {
    flex: 1,
    fontSize: 14,
    color: '#000',
  },
  filterBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  list: {
    padding: 16,
  },
  productCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  imageContainer: {
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
  },
  productTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  variantCount: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  variantsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  variantChip: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 4,
    marginBottom: 4,
  },
  variantChipText: {
    fontSize: 11,
    color: '#666',
  },
  moreVariants: {
    fontSize: 11,
    color: '#999',
    paddingVertical: 4,
  },
  productActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  actionText: {
    fontSize: 12,
    color: '#111',
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    fontSize: 14,
  },
  modalLabel: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  modalOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalScroll: {
    maxHeight: 60,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  optionChipActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  optionText: {
    fontSize: 12,
    color: '#000',
  },
  optionTextActive: {
    color: '#fff',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  modalBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
  },
  modalBtnPrimary: {
    backgroundColor: '#000',
  },
  modalBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  modalBtnTextPrimary: {
    color: '#fff',
  },
});
