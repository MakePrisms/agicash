import Foundation
import Security

/// Minimal Keychain wrapper for the persisted Agicash session. The Rust FFI
/// keeps in-memory state only; this type bridges that to iOS Keychain so the
/// user stays signed in across app launches.
///
/// Format on disk: JSON `{"userId":"<uuid>","refreshToken":"<jwt>"}` stored
/// under a single generic-password item (kSecClassGenericPassword) with the
/// app's bundle id as the service and a static account name.
struct PersistedSession: Codable, Equatable {
    let userId: String
    let refreshToken: String
}

enum SessionStoreError: Error, CustomStringConvertible {
    case keychain(OSStatus)
    case encode(Error)
    case decode(Error)

    var description: String {
        switch self {
        case .keychain(let status): return "keychain error: \(status)"
        case .encode(let err): return "encode session: \(err)"
        case .decode(let err): return "decode session: \(err)"
        }
    }
}

enum SessionStore {
    /// Generic-password service identifier. Matches the iOS bundle id so the
    /// Keychain entry follows the app's lifecycle (uninstall clears it).
    private static let service = "com.makeprisms.agicash"
    private static let account = "session"

    static func load() throws -> PersistedSession? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: AnyObject?
        let status = withUnsafeMutablePointer(to: &item) {
            SecItemCopyMatching(query as CFDictionary, $0)
        }
        _ = query
        if status == errSecItemNotFound {
            return nil
        }
        if status != errSecSuccess {
            throw SessionStoreError.keychain(status)
        }
        guard let data = item as? Data else {
            return nil
        }
        do {
            return try JSONDecoder().decode(PersistedSession.self, from: data)
        } catch {
            throw SessionStoreError.decode(error)
        }
    }

    static func save(_ session: PersistedSession) throws {
        let payload: Data
        do {
            payload = try JSONEncoder().encode(session)
        } catch {
            throw SessionStoreError.encode(error)
        }
        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attrs: [String: Any] = [
            kSecValueData as String: payload,
            // After first unlock so background refresh hooks (future) can read.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemUpdate(baseQuery as CFDictionary, attrs as CFDictionary)
        switch status {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            var addQuery = baseQuery
            addQuery.merge(attrs) { _, new in new }
            let add = SecItemAdd(addQuery as CFDictionary, nil)
            if add != errSecSuccess {
                throw SessionStoreError.keychain(add)
            }
        default:
            throw SessionStoreError.keychain(status)
        }
    }

    static func clear() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw SessionStoreError.keychain(status)
        }
    }
}
