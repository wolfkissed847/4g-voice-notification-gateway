import { apiRequest } from "./client";
import type { Contact, Group } from "../types";

export function listGroups(): Promise<Group[]> {
  return apiRequest<Group[]>("/groups");
}

export function createGroup(data: { name: string; description?: string }): Promise<Group> {
  return apiRequest<Group>("/groups", { method: "POST", body: data });
}

export function updateGroup(id: number, data: { name?: string; description?: string }): Promise<Group> {
  return apiRequest<Group>(`/groups/${id}`, { method: "PUT", body: data });
}

export function deleteGroup(id: number): Promise<void> {
  return apiRequest<void>(`/groups/${id}`, { method: "DELETE" });
}

export function listContacts(groupId: number): Promise<Contact[]> {
  return apiRequest<Contact[]>(`/groups/${groupId}/contacts`);
}

export function createContact(
  groupId: number,
  data: { phone_number: string; name?: string }
): Promise<Contact> {
  return apiRequest<Contact>(`/groups/${groupId}/contacts`, { method: "POST", body: data });
}

export function updateContact(
  id: number,
  data: { phone_number?: string; name?: string }
): Promise<Contact> {
  return apiRequest<Contact>(`/contacts/${id}`, { method: "PUT", body: data });
}

export function deleteContact(id: number): Promise<void> {
  return apiRequest<void>(`/contacts/${id}`, { method: "DELETE" });
}

export function reorderContacts(groupId: number, orderedIds: number[]): Promise<Contact[]> {
  return apiRequest<Contact[]>(`/groups/${groupId}/contacts/reorder`, {
    method: "PUT",
    body: { ordered_ids: orderedIds },
  });
}
