"use client";

import { useState, useEffect } from "react";
import {
    Users,
    Shield,
    Plus,
    Edit,
    Trash2,
    UserCheck,
    UserX,
    Crown,
} from "lucide-react";

import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

import {
    getUsers,
    getRoles,
    setUserRoles,
    toggleUserActive,
    getRBACStats,
    type UserProfile,
    type Role,
} from "@/lib/rbac";

const roleColors: Record<string, string> = {
    admin: "bg-red-500/20 text-red-400 border-red-500/30",
    manager: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    cashier: "bg-green-500/20 text-green-400 border-green-500/30",
    viewer: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

function UsersContent() {
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const [search, setSearch] = useState("");

    const [showRoleDialog, setShowRoleDialog] = useState(false);
    const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
    const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    const loadData = async () => {
        setLoading(true);
        const [usersData, rolesData, statsData] = await Promise.all([
            getUsers(),
            getRoles(),
            getRBACStats(),
        ]);
        setUsers(usersData);
        setRoles(rolesData);
        setStats(statsData);
        setLoading(false);
    };

    useEffect(() => {
        loadData();
    }, []);

    const filteredUsers = users.filter((u) => {
        if (!search) return true;
        const query = search.toLowerCase();
        return (
            u.full_name?.toLowerCase().includes(query) ||
            u.email?.toLowerCase().includes(query)
        );
    });

    const handleEditRoles = (user: UserProfile) => {
        setSelectedUser(user);
        setSelectedRoles(user.roles?.map(r => r.role_id) || []);
        setShowRoleDialog(true);
    };

    const handleSaveRoles = async () => {
        if (!selectedUser) return;
        setSaving(true);
        try {
            await setUserRoles(selectedUser.id, selectedRoles);
            setShowRoleDialog(false);
            loadData();
        } catch (error) {
            console.error("Error:", error);
            alert("Failed to update roles");
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (user: UserProfile) => {
        try {
            await toggleUserActive(user.id, !user.is_active);
            loadData();
        } catch (error) {
            console.error("Error:", error);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="User Management" subtitle="Manage users and roles" />

            <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-primary/10">
                                <Users className="w-6 h-6 text-primary" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Total Users</p>
                                <p className="text-2xl font-semibold">{stats?.totalUsers || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-green-500/10">
                                <UserCheck className="w-6 h-6 text-green-400" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Active</p>
                                <p className="text-2xl font-semibold">{stats?.activeUsers || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-card border-border">
                        <CardContent className="pt-6 flex items-center gap-4">
                            <div className="p-3 rounded-lg bg-blue-500/10">
                                <Shield className="w-6 h-6 text-blue-400" />
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground">Roles</p>
                                <p className="text-2xl font-semibold">{stats?.totalRoles || 0}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Roles Legend */}
                <Card className="bg-card border-border mb-6">
                    <CardHeader>
                        <CardTitle className="text-sm">Available Roles</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-4">
                            {roles.map((role) => (
                                <div key={role.id} className="flex items-center gap-2">
                                    <Badge className={roleColors[role.name] || "bg-gray-500/20"}>
                                        {role.name === "admin" && <Crown className="w-3 h-3 mr-1" />}
                                        {role.name}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                        {role.description}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Search */}
                <div className="flex items-center gap-4 mb-6">
                    <Input
                        placeholder="Search users..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="max-w-sm bg-card"
                    />
                </div>

                {/* Users Table */}
                <Card className="bg-card border-border">
                    <CardContent className="pt-6">
                        {loading ? (
                            <div className="text-center py-12 text-muted-foreground">Loading...</div>
                        ) : filteredUsers.length === 0 ? (
                            <div className="text-center py-12">
                                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                                <p className="text-muted-foreground">No users found</p>
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-border">
                                        <TableHead>User</TableHead>
                                        <TableHead>Roles</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Last Login</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredUsers.map((user) => (
                                        <TableRow key={user.id} className="border-border">
                                            <TableCell>
                                                <div>
                                                    <p className="font-medium">{user.full_name || "No name"}</p>
                                                    <p className="text-xs text-muted-foreground">{user.email}</p>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1">
                                                    {user.roles?.map((r) => (
                                                        <Badge
                                                            key={r.role_id}
                                                            variant="outline"
                                                            className={roleColors[r.role_name] || ""}
                                                        >
                                                            {r.role_name}
                                                        </Badge>
                                                    )) || (
                                                            <span className="text-xs text-muted-foreground">No roles</span>
                                                        )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    className={
                                                        user.is_active
                                                            ? "bg-green-500/20 text-green-400"
                                                            : "bg-red-500/20 text-red-400"
                                                    }
                                                >
                                                    {user.is_active ? "Active" : "Inactive"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {user.last_login
                                                    ? new Date(user.last_login).toLocaleDateString()
                                                    : "Never"}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleEditRoles(user)}
                                                    >
                                                        <Shield className="w-4 h-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleToggleActive(user)}
                                                    >
                                                        {user.is_active ? (
                                                            <UserX className="w-4 h-4 text-red-400" />
                                                        ) : (
                                                            <UserCheck className="w-4 h-4 text-green-400" />
                                                        )}
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Role Assignment Dialog */}
            <Dialog open={showRoleDialog} onOpenChange={setShowRoleDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Assign Roles to {selectedUser?.full_name}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        {roles.map((role) => (
                            <div key={role.id} className="flex items-center gap-3">
                                <Checkbox
                                    id={role.id}
                                    checked={selectedRoles.includes(role.id)}
                                    onCheckedChange={(checked) => {
                                        if (checked) {
                                            setSelectedRoles([...selectedRoles, role.id]);
                                        } else {
                                            setSelectedRoles(selectedRoles.filter(r => r !== role.id));
                                        }
                                    }}
                                />
                                <div className="flex-1">
                                    <Label htmlFor={role.id} className="font-medium">
                                        {role.name}
                                    </Label>
                                    <p className="text-xs text-muted-foreground">{role.description}</p>
                                </div>
                            </div>
                        ))}
                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="outline" onClick={() => setShowRoleDialog(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleSaveRoles}
                                disabled={saving}
                                className="bg-primary text-midnight"
                            >
                                {saving ? "Saving..." : "Save Roles"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function UsersPage() {
    return (
        <ProtectedRoute resource="users" action="read">
            <UsersContent />
        </ProtectedRoute>
    );
}


