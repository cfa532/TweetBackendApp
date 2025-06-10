# Tweet backend to support user operations.

## Testing:

App mid: d4lRyhABgqOnqY4bURSm_T-4FZ4

Upgrade: hdF-zawE_0MH0TSVuBvAU_yA0HA

Admin: minipc, uTE6yhCWGLlkK6KGI9iMkOFZGGv

## Release:

App mid: heWgeGkeBX2gaENbIBS_Iy1mdTS

Upgrade: 9OCLYP-SXzen3e171-Ei_6N3Gwl

Admin: minipc, mwmQCHCEHClCIJy-bItx5ALAhq9

    func registerUser(
        username: String,
        password: String,
        alias: String?,
        profile: String,
        hostId: String? = nil
    ) async throws -> Bool {
        guard let service = hproseClient else {
            throw NSError(domain: "HproseService", code: -1, userInfo: [NSLocalizedDescriptionKey: "Service not initialized"])
        }
        var hosts: [String]? = nil
        if let hostId = hostId, !hostId.isEmpty {
            hosts = [hostId]
        }
        let appUser = await AppUserStore.shared.getAppUser()
        let newUser = User(mid: appUser.mid, name: alias, username: username, password: password,
                           profile: profile, hostIds: hosts)
        let entry = "register"
        let params = [
            "aid": Self.appId,
            "ver": "last",
            "user": String(data: try JSONEncoder().encode(newUser), encoding: .utf8) ?? "",
            "followings": String(data: try JSONEncoder().encode(Gadget.getAlphaIds()), encoding: .utf8) ?? ""
        ]
        guard let response = service.runMApp(entry, params, nil) as? [String: Any] else {
            throw NSError(domain: "HproseService", code: -1, userInfo: [NSLocalizedDescriptionKey: "Registration failure."])
        }
        if let result = response["status"] as? String {
            if result == "success" {
                return true
            } else {
                throw NSError(domain: "hproseService", code: -1, userInfo: [NSLocalizedDescriptionKey: response["reason"] as? String ?? "Unknown registration error."])
            }
        }
        return false
    }
    
    func updateUserCore(
        password: String? = nil,
        alias: String? = nil,
        profile: String? = nil,
        hostId: String? = nil,
    ) async throws -> Bool {
        guard let service = hproseClient else {
            throw NSError(domain: "HproseService", code: -1, userInfo: [NSLocalizedDescriptionKey: "Service not initialized"])
        }
        let appUser = await AppUserStore.shared.getAppUser()
        let updatedUser = User(mid: appUser.mid, name: alias, password: password, profile: profile)
        if let hostId = hostId, !hostId.isEmpty {
            updatedUser.hostIds = [hostId]
        }

        let entry = "set_author_core_data"
        let params = [
            "aid": Self.appId,
            "ver": "last",
            "user": String(data: try JSONEncoder().encode(updatedUser), encoding: .utf8) ?? ""
        ]
        guard let response = service.runMApp(entry, params, nil) as? [String: Any] else {
            throw NSError(domain: "HproseService", code: -1, userInfo: [NSLocalizedDescriptionKey: "Registration failure."])
        }
        if let result = response["status"] as? String {
            if result == "success" {
                return true
            } else {
                throw NSError(domain: "hproseService", code: -1, userInfo: [NSLocalizedDescriptionKey: response["reason"] as? String ?? "Unknown registration error."])
            }
        }
        return false
    }

    // MARK: - User Avatar
    /// Sets the user's avatar on the server
    func setUserAvatar(user: User, avatar: String) async throws {
        guard let service = hproseClient else {
            throw NSError(domain: "HproseService", code: -1, userInfo: [NSLocalizedDescriptionKey: "Service not initialized"])
        }
        let entry = "set_user_avatar"
        let params: [String: Any] = [
            "aid": Self.appId,
            "ver": "last",
            "userid": user.mid,
            "avatar": avatar
        ]
        _ = service.runMApp(entry, params, nil)
    }

    /// Find IP addresses of given nodeId
    func getHostIP(_ nodeId: String) async -> String? {
        let appUser = await AppUserStore.shared.getAppUser()
        let urlString = "\(appUser.baseUrl ?? HproseInstance.baseUrl)/getvar?name=ips&arg0=\(nodeId)"
        guard let url = URL(string: urlString) else { return nil }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: CharacterSet(charactersIn: "\" ,\n\r")) ?? ""
                let ips = text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                if !ips.isEmpty {
                    // For now, just return the first IP (stub for getAccessibleIP2)
                    return ips.first
                }
            }
        } catch {
            print("[getHostIP] Error: \(error) \(urlString)")
        }
        return nil
    }