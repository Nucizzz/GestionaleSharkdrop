import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, RefreshControl, Platform, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../src/services/api';
import { useAuthStore } from '../src/store/authStore';
import { Button } from '../src/components/Button';
import { Input } from '../src/components/Input';
import { safeBack } from '../src/utils/safeBack';

interface User {
  id: string;
  username: string;
  role: string;
  is_active: boolean;
  created_at?: string;
  blocked_at?: string;
  blocked_reason?: string;
}

interface ActionLog {
  id: string;
  action_type: string;
  username: string;
  description: string;
  created_at: string;
  entity_type?: string;
}

interface Transaction {
  id: string;
  transaction_type: string;
  username: string;
  quantity: number;
  product_title?: string;
  variant_title?: string;
  created_at: string;
  is_rolled_back: boolean;
  sale_price?: number;
}

type TabType = 'users' | 'logs' | 'transactions';

export default function UsersManagementScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuthStore();
  
  const [activeTab, setActiveTab] = useState<TabType>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Modal states
  const [showUserModal, setShowUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'operator' | 'admin'>('operator');
  const [saving, setSaving] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [blockTarget, setBlockTarget] = useState<User | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      
      const [usersData, logsData, txData] = await Promise.all([
        api.getUsers(),
        api.getActionLogs(0, 100),
        api.getInventoryTransactions(0, 100)
      ]);
      
      setUsers(usersData);
      setLogs(logsData.logs || []);
      setTransactions(txData.transactions || []);
    } catch (error) {
      console.error('Error loading data:', error);
      Alert.alert('Errore', 'Errore nel caricamento dei dati');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (user && user.role !== 'admin') {
      Alert.alert('Accesso Negato', 'Solo gli admin possono accedere a questa pagina');
      safeBack(router);
    }
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleCreateUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      Alert.alert('Errore', 'Compila tutti i campi');
      return;
    }
    
    setSaving(true);
    try {
      await api.createUser({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole
      });
      setShowUserModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewRole('operator');
      loadData();
      Alert.alert('Successo', 'Utente creato');
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore nella creazione');
    } finally {
      setSaving(false);
    }
  };

  const handleBlockUser = async (userToBlock: User) => {
    setBlockTarget(userToBlock);
    setBlockReason('');
    setShowBlockModal(true);
  };

  const confirmBlockUser = async () => {
    if (!blockTarget) return;
    try {
      await api.blockUser(blockTarget.id, blockReason.trim() || undefined);
      setShowBlockModal(false);
      setBlockTarget(null);
      setBlockReason('');
      loadData();
      Alert.alert('Successo', `Utente "${blockTarget.username}" bloccato`);
    } catch (error: any) {
      Alert.alert('Errore', error.response?.data?.detail || 'Errore nel blocco');
    }
  };

  const handleUnblockUser = async (userToUnblock: User) => {
    Alert.alert(
      'Sblocca Utente',
      `Vuoi sbloccare "${userToUnblock.username}"?`,
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: 'Sblocca',
          onPress: async () => {
            try {
              await api.unblockUser(userToUnblock.id);
              loadData();
              Alert.alert('Successo', `Utente "${userToUnblock.username}" sbloccato`);
            } catch (error: any) {
              Alert.alert('Errore', error.response?.data?.detail || 'Errore nello sblocco');
            }
          }
        }
      ]
    );
  };

  const handleRollback = async (tx: Transaction) => {
    Alert.alert(
      'Annulla Operazione',
      `Vuoi annullare questa operazione?\n\n${tx.transaction_type.toUpperCase()}: ${tx.quantity}x ${tx.product_title || 'Prodotto'}\n\nEffettuata da: ${tx.username}`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sì, Annulla',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.rollbackTransaction(tx.id);
              loadData();
              Alert.alert('Successo', 'Operazione annullata. L\'inventario è stato ripristinato.');
            } catch (error: any) {
              Alert.alert('Errore', error.response?.data?.detail || 'Errore nel rollback');
            }
          }
        }
      ]
    );
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('it-IT', { 
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const getActionIcon = (actionType: string) => {
    if (actionType.includes('user')) return 'person';
    if (actionType.includes('inventory') || actionType.includes('sale')) return 'cube';
    if (actionType.includes('location')) return 'location';
    if (actionType.includes('shelf')) return 'grid';
    if (actionType.includes('rollback')) return 'arrow-undo';
    return 'document';
  };

  const getTxIcon = (txType: string) => {
    switch (txType) {
      case 'receive': return 'arrow-down-circle';
      case 'sale': return 'cart';
      case 'move': return 'swap-horizontal';
      case 'transfer': return 'repeat';
      case 'adjust': return 'construct';
      default: return 'cube';
    }
  };

  const getTxColor = (txType: string) => {
    switch (txType) {
      case 'receive': return '#22c55e';
      case 'sale': return '#3b82f6';
      case 'move': return '#f59e0b';
      case 'transfer': return '#8b5cf6';
      case 'adjust': return '#ef4444';
      default: return '#666';
    }
  };

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
        <Text style={styles.title}>Gestione & Log</Text>
        <TouchableOpacity onPress={loadData} style={styles.backButton}>
          <Ionicons name="refresh" size={22} color="#000" />
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'users' && styles.tabActive]}
          onPress={() => setActiveTab('users')}
        >
          <Ionicons name="people" size={18} color={activeTab === 'users' ? '#000' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'users' && styles.tabTextActive]}>
            Utenti ({users.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'transactions' && styles.tabActive]}
          onPress={() => setActiveTab('transactions')}
        >
          <Ionicons name="swap-vertical" size={18} color={activeTab === 'transactions' ? '#000' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'transactions' && styles.tabTextActive]}>
            Operazioni
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'logs' && styles.tabActive]}
          onPress={() => setActiveTab('logs')}
        >
          <Ionicons name="list" size={18} color={activeTab === 'logs' ? '#000' : '#666'} />
          <Text style={[styles.tabText, activeTab === 'logs' && styles.tabTextActive]}>
            Log
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView 
        style={styles.content} 
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {activeTab === 'users' && (
          <>
            {users.map((u) => (
              <View key={u.id} style={[styles.card, !u.is_active && styles.cardBlocked]}>
                <View style={styles.cardHeader}>
                  <View style={styles.userInfo}>
                    <View style={[styles.avatar, u.role === 'admin' && styles.avatarAdmin]}>
                      <Text style={styles.avatarText}>{u.username[0].toUpperCase()}</Text>
                    </View>
                    <View>
                      <Text style={styles.cardTitle}>{u.username}</Text>
                      <View style={styles.badgeRow}>
                        <View style={[styles.badge, u.role === 'admin' ? styles.badgeAdmin : styles.badgeOperator]}>
                          <Text style={styles.badgeText}>{u.role === 'admin' ? 'Admin' : 'Operatore'}</Text>
                        </View>
                        {!u.is_active && (
                          <View style={[styles.badge, styles.badgeBlocked]}>
                            <Text style={styles.badgeText}>Bloccato</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                  
                  {u.role !== 'admin' && (
                    <TouchableOpacity
                      style={[styles.actionBtn, u.is_active ? styles.actionBtnDanger : styles.actionBtnSuccess]}
                      onPress={() => u.is_active ? handleBlockUser(u) : handleUnblockUser(u)}
                    >
                      <Ionicons 
                        name={u.is_active ? "ban" : "checkmark-circle"} 
                        size={20} 
                        color="#fff" 
                      />
                    </TouchableOpacity>
                  )}
                </View>
                
                {u.blocked_reason && (
                  <Text style={styles.blockedReason}>Motivo: {u.blocked_reason}</Text>
                )}
              </View>
            ))}
          </>
        )}

        {activeTab === 'transactions' && (
          <>
            {transactions.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="swap-vertical-outline" size={48} color="#ccc" />
                <Text style={styles.emptyText}>Nessuna operazione</Text>
              </View>
            ) : (
              transactions.map((tx) => (
                <View key={tx.id} style={[styles.card, tx.is_rolled_back && styles.cardRolledBack]}>
                  <View style={styles.txHeader}>
                    <View style={[styles.txIcon, { backgroundColor: getTxColor(tx.transaction_type) }]}>
                      <Ionicons name={getTxIcon(tx.transaction_type) as any} size={20} color="#fff" />
                    </View>
                    <View style={styles.txInfo}>
                      <Text style={styles.txType}>{tx.transaction_type.toUpperCase()}</Text>
                      <Text style={styles.txProduct}>{tx.product_title} {tx.variant_title && `(${tx.variant_title})`}</Text>
                      <Text style={styles.txMeta}>
                        {tx.quantity}x • {tx.username} • {formatDate(tx.created_at)}
                        {tx.sale_price && ` • €${tx.sale_price}`}
                      </Text>
                    </View>
                    
                    {!tx.is_rolled_back ? (
                      <TouchableOpacity
                        style={styles.rollbackBtn}
                        onPress={() => handleRollback(tx)}
                      >
                        <Ionicons name="arrow-undo" size={20} color="#dc2626" />
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.rolledBackBadge}>
                        <Text style={styles.rolledBackText}>Annullato</Text>
                      </View>
                    )}
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {activeTab === 'logs' && (
          <>
            {logs.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="list-outline" size={48} color="#ccc" />
                <Text style={styles.emptyText}>Nessun log</Text>
              </View>
            ) : (
              logs.map((log) => (
                <View key={log.id} style={styles.logCard}>
                  <View style={styles.logIcon}>
                    <Ionicons name={getActionIcon(log.action_type) as any} size={16} color="#666" />
                  </View>
                  <View style={styles.logContent}>
                    <Text style={styles.logDescription}>{log.description}</Text>
                    <Text style={styles.logMeta}>{log.username} • {formatDate(log.created_at)}</Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* FAB for adding users */}
      {activeTab === 'users' && (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 20 }]}
          onPress={() => setShowUserModal(true)}
        >
          <Ionicons name="person-add" size={24} color="#fff" />
        </TouchableOpacity>
      )}

      {/* New User Modal */}
      <Modal
        visible={showUserModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowUserModal(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top + 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowUserModal(false)}>
              <Text style={styles.modalCancel}>Annulla</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Nuovo Utente</Text>
            <TouchableOpacity onPress={handleCreateUser} disabled={saving}>
              <Text style={[styles.modalSave, saving && { opacity: 0.5 }]}>
                {saving ? '...' : 'Crea'}
              </Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalContent}>
            <Input
              label="Username *"
              value={newUsername}
              onChangeText={setNewUsername}
              placeholder="es. mario"
              autoCapitalize="none"
            />
            <Input
              label="Password *"
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Minimo 6 caratteri"
              secureTextEntry
            />
            
            <Text style={styles.inputLabel}>Ruolo *</Text>
            <View style={styles.roleSelector}>
              <TouchableOpacity
                style={[styles.roleOption, newRole === 'operator' && styles.roleOptionActive]}
                onPress={() => setNewRole('operator')}
              >
                <Ionicons 
                  name={newRole === 'operator' ? "checkmark-circle" : "ellipse-outline"} 
                  size={20} 
                  color={newRole === 'operator' ? "#fff" : "#666"} 
                />
                <Text style={[styles.roleText, newRole === 'operator' && styles.roleTextActive]}>
                  Operatore
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.roleOption, newRole === 'admin' && styles.roleOptionActive]}
                onPress={() => setNewRole('admin')}
              >
                <Ionicons 
                  name={newRole === 'admin' ? "checkmark-circle" : "ellipse-outline"} 
                  size={20} 
                  color={newRole === 'admin' ? "#fff" : "#666"} 
                />
                <Text style={[styles.roleText, newRole === 'admin' && styles.roleTextActive]}>
                  Admin
                </Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.infoBox}>
              <Ionicons name="information-circle" size={20} color="#3b82f6" />
              <Text style={styles.infoText}>
                Gli operatori possono eseguire tutte le operazioni di inventario ma non possono gestire utenti, vedere i log o fare rollback.
              </Text>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Block User Modal */}
      <Modal
        visible={showBlockModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowBlockModal(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top + 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowBlockModal(false)}>
              <Text style={styles.modalCancel}>Annulla</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Blocca Utente</Text>
            <TouchableOpacity onPress={confirmBlockUser}>
              <Text style={styles.modalSave}>Blocca</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.modalLabel}>Motivo (opzionale)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Es. abuso, account compromesso..."
              value={blockReason}
              onChangeText={setBlockReason}
            />
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
    fontSize: 18,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 4,
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  cardBlocked: {
    opacity: 0.6,
    borderColor: '#dc2626',
  },
  cardRolledBack: {
    opacity: 0.5,
    backgroundColor: '#f5f5f5',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarAdmin: {
    backgroundColor: '#000',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeAdmin: {
    backgroundColor: '#000',
  },
  badgeOperator: {
    backgroundColor: '#3b82f6',
  },
  badgeBlocked: {
    backgroundColor: '#dc2626',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
    textTransform: 'uppercase',
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnDanger: {
    backgroundColor: '#dc2626',
  },
  actionBtnSuccess: {
    backgroundColor: '#22c55e',
  },
  blockedReason: {
    marginTop: 8,
    fontSize: 12,
    color: '#dc2626',
    fontStyle: 'italic',
  },
  txHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  txIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txInfo: {
    flex: 1,
  },
  txType: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
  },
  txProduct: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
    marginTop: 2,
  },
  txMeta: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  rollbackBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rolledBackBadge: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  rolledBackText: {
    fontSize: 10,
    color: '#999',
    fontWeight: '600',
  },
  logCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  logIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logContent: {
    flex: 1,
  },
  logDescription: {
    fontSize: 13,
    color: '#000',
  },
  logMeta: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: '#999',
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
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
      web: {
        boxShadow: '0px 4px 10px rgba(0,0,0,0.25)',
      },
    }),
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
  modalLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    fontSize: 14,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    marginBottom: 8,
    marginTop: 8,
  },
  roleSelector: {
    gap: 8,
    marginBottom: 16,
  },
  roleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    gap: 12,
  },
  roleOptionActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  roleText: {
    fontSize: 15,
    color: '#000',
    fontWeight: '500',
  },
  roleTextActive: {
    color: '#fff',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    padding: 12,
    gap: 10,
    marginTop: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#3b82f6',
    lineHeight: 18,
  },
});
