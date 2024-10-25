/*
  Warnings:

  - You are about to drop the column `artist_id` on the `Song` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `Artist` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE `Song` DROP FOREIGN KEY `Song_artist_id_fkey`;

-- AlterTable
ALTER TABLE `Song` DROP COLUMN `artist_id`;

-- CreateTable
CREATE TABLE `SongArtist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `songId` INTEGER NOT NULL,
    `artistId` INTEGER NOT NULL,
    `featuredArtistId` INTEGER NULL,
    `isMainArtist` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SongArtist_songId_idx`(`songId`),
    INDEX `SongArtist_artistId_idx`(`artistId`),
    INDEX `SongArtist_featuredArtistId_idx`(`featuredArtistId`),
    UNIQUE INDEX `SongArtist_songId_artistId_isMainArtist_key`(`songId`, `artistId`, `isMainArtist`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Artist_name_key` ON `Artist`(`name`);

-- AddForeignKey
ALTER TABLE `SongArtist` ADD CONSTRAINT `SongArtist_songId_fkey` FOREIGN KEY (`songId`) REFERENCES `Song`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SongArtist` ADD CONSTRAINT `SongArtist_artistId_fkey` FOREIGN KEY (`artistId`) REFERENCES `Artist`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SongArtist` ADD CONSTRAINT `SongArtist_featuredArtistId_fkey` FOREIGN KEY (`featuredArtistId`) REFERENCES `Artist`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- RedefineIndex
CREATE INDEX `Sample_original_song_id_idx` ON `Sample`(`original_song_id`);
DROP INDEX `Sample_original_song_id_fkey` ON `Sample`;

-- RedefineIndex
CREATE INDEX `Sample_sampled_in_song_id_idx` ON `Sample`(`sampled_in_song_id`);
DROP INDEX `Sample_sampled_in_song_id_fkey` ON `Sample`;
