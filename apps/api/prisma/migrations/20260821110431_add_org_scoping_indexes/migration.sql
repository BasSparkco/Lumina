-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Layout_organizationId_createdAt_idx" ON "Layout"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrgInvite_organizationId_idx" ON "OrgInvite"("organizationId");

-- CreateIndex
CREATE INDEX "Playlist_organizationId_updatedAt_idx" ON "Playlist"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "PowerSchedule_screenId_idx" ON "PowerSchedule"("screenId");

-- CreateIndex
CREATE INDEX "PowerSchedule_groupId_idx" ON "PowerSchedule"("groupId");

-- CreateIndex
CREATE INDEX "PowerSchedule_organizationId_idx" ON "PowerSchedule"("organizationId");

-- CreateIndex
CREATE INDEX "Schedule_screenId_idx" ON "Schedule"("screenId");

-- CreateIndex
CREATE INDEX "Schedule_organizationId_idx" ON "Schedule"("organizationId");

-- CreateIndex
CREATE INDEX "Screen_organizationId_createdAt_idx" ON "Screen"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenGroup_organizationId_name_idx" ON "ScreenGroup"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Theme_organizationId_createdAt_idx" ON "Theme"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "Zone_layoutId_idx" ON "Zone"("layoutId");

-- CreateIndex
CREATE INDEX "Zone_playlistId_idx" ON "Zone"("playlistId");
