-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Oct 17, 2026 at 12:55 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `fernando_exe_db`
--

-- --------------------------------------------------------

--
-- Table structure for table `expenses`
--

CREATE TABLE `expenses` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `category` varchar(100) NOT NULL,
  `expense_date` date NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `expenses`
--

INSERT INTO `expenses` (`id`, `user_id`, `title`, `amount`, `category`, `expense_date`, `created_at`) VALUES
(1, 2, 'Lunch', 450.00, 'Food', '2026-10-01', '2026-10-17 10:15:11'),
(2, 2, 'Bus fare', 180.00, 'Transport', '2026-10-02', '2026-10-17 10:15:11'),
(3, 2, 'Internet bundle', 250.00, 'Internet', '2026-10-03', '2026-10-17 10:15:11'),
(4, 2, 'Notebook', 120.00, 'Education', '2026-10-04', '2026-10-17 10:15:11'),
(5, 3, 'Groceries', 1800.00, 'Shopping', '2026-10-02', '2026-10-17 10:15:11'),
(6, 3, 'Coffee', 300.00, 'Food', '2026-10-05', '2026-10-17 10:15:11'),
(7, 3, 'Taxi', 650.00, 'Transport', '2026-10-06', '2026-10-17 10:15:11'),
(8, 3, 'Cloud hosting', 900.00, 'Technology', '2026-10-07', '2026-10-17 10:15:11'),
(9, 4, 'Textbooks', 2200.00, 'Education', '2026-10-03', '2026-10-17 10:15:11'),
(10, 4, 'Dinner', 750.00, 'Food', '2026-10-08', '2026-10-17 10:15:11'),
(11, 4, 'Phone repair', 1500.00, 'Technology', '2026-10-09', '2026-10-17 10:15:11'),
(12, 4, 'Train ticket', 500.00, 'Transport', '2026-10-10', '2026-10-17 10:15:11'),
(13, 5, 'Headphones', 3200.00, 'Shopping', '2026-10-04', '2026-10-17 10:15:11'),
(14, 5, 'Lunch', 380.00, 'Food', '2026-10-11', '2026-10-17 10:15:11'),
(15, 5, 'Software subscription', 1200.00, 'Technology', '2026-10-12', '2026-10-17 10:15:11'),
(16, 5, 'Matatu fare', 160.00, 'Transport', '2026-10-13', '2026-10-17 10:15:11'),
(17, 6, 'Groceries', 1250.00, 'Shopping', '2026-10-05', '2026-10-17 10:15:11'),
(18, 6, 'Mobile data', 200.00, 'Internet', '2026-10-14', '2026-10-17 10:15:11'),
(19, 6, 'Course materials', 850.00, 'Education', '2026-10-15', '2026-10-17 10:15:11'),
(20, 6, 'Movie ticket', 700.00, 'Entertainment', '2026-10-16', '2026-10-17 10:15:11');

-- --------------------------------------------------------

--
-- Table structure for table `notes`
--

CREATE TABLE `notes` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` longtext DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `notes`
--

INSERT INTO `notes` (`id`, `user_id`, `title`, `content`, `created_at`, `updated_at`) VALUES
(1, 2, 'Project Ideas', 'Build a personal finance dashboard and a portfolio website.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(2, 2, 'Weekly Goals', 'Complete API integration and write unit tests.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(3, 2, 'Meeting Notes', 'Discuss design improvements and deployment plans.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(4, 3, 'Shopping List', 'Milk, bread, eggs, vegetables and rice.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(5, 3, 'Release Checklist', 'Test checkout, validate forms and review accessibility.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(6, 3, 'Ideas', 'Try adding product recommendations.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(7, 4, 'Study Notes', 'Review database relationships and SQL joins.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(8, 4, 'Sprint Plan', 'Complete charts, responsive styling and tests.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(9, 4, 'Useful Links', 'Keep documentation links for Flask and MySQL.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(10, 5, 'Robot Config', 'Check sensor wiring and test device connectivity.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(11, 5, 'Security Notes', 'Validate inputs and verify ownership on protected routes.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(12, 5, 'Next Steps', 'Test dashboard controls and improve error handling.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(13, 6, 'Recipe Ideas', 'Try pasta, vegetable curry and homemade pizza.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(14, 6, 'Study Plan', 'Revise daily and complete practice questions.', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(15, 6, 'App Improvements', 'Add search filters and a favourites page.', '2026-10-17 10:15:11', '2026-10-17 10:15:11');

-- --------------------------------------------------------

--
-- Table structure for table `projects`
--

CREATE TABLE `projects` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `status` enum('active','completed','on_hold','archived') NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `projects`
--

INSERT INTO `projects` (`id`, `user_id`, `title`, `description`, `status`, `created_at`, `updated_at`) VALUES
(1, 2, 'Portfolio Website', 'Personal developer portfolio', 'active', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(2, 2, 'Expense Tracker', 'Track spending and monthly budgets', 'completed', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(3, 2, 'AI Assistant', 'Build a personal AI assistant', 'on_hold', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(4, 3, 'E-commerce App', 'Online store with shopping cart', 'active', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(5, 3, 'Weather Dashboard', 'Weather API integration', 'completed', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(6, 3, 'Mobile UI', 'Design a mobile-first interface', 'active', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(7, 4, 'Task Manager', 'Productivity and task management', 'active', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(8, 4, 'Blog Platform', 'Publish articles and posts', 'on_hold', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(9, 4, 'Data Visualizer', 'Interactive charts and graphs', 'completed', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(10, 5, 'Robotics Dashboard', 'Control and monitor robot devices', 'active', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(11, 5, 'School Portal', 'Student information system', 'completed', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(12, 5, 'Security Scanner', 'Basic website security checks', 'active', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(13, 6, 'Recipe Finder', 'Search and save recipes', 'active', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(14, 6, 'Music Player', 'Web-based music player', 'completed', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(15, 6, 'Study Planner', 'Organize academic schedules', 'archived', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(16, 8, 'Hexapod Spider', '6 legged creature made from servos and stuff like that', 'active', '2026-10-17 10:34:56', '2026-10-17 10:34:56');

-- --------------------------------------------------------

--
-- Table structure for table `tasks`
--

CREATE TABLE `tasks` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `status` enum('pending','in_progress','completed') NOT NULL DEFAULT 'pending',
  `due_date` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `tasks`
--

INSERT INTO `tasks` (`id`, `user_id`, `title`, `description`, `status`, `due_date`, `created_at`, `updated_at`) VALUES
(1, 2, 'Finish homepage', 'Complete portfolio homepage styling', 'completed', '2026-10-01', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(2, 2, 'Connect API', 'Connect frontend to Flask backend', 'in_progress', '2026-10-20', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(3, 2, 'Write tests', 'Test project endpoints', 'pending', '2026-10-22', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(4, 2, 'Update README', 'Document installation and setup', 'pending', '2026-10-25', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(5, 3, 'Build product cards', 'Create reusable product cards', 'completed', '2026-10-04', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(6, 3, 'Add checkout', 'Implement checkout flow', 'in_progress', '2026-10-21', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(7, 3, 'Test payments', 'Test payment form validation', 'pending', '2026-10-24', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(8, 3, 'Improve accessibility', 'Add labels and keyboard navigation', 'pending', '2026-10-26', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(9, 4, 'Design dashboard', 'Create dashboard wireframes', 'completed', '2026-10-06', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(10, 4, 'Create charts', 'Display spending statistics', 'in_progress', '2026-10-22', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(11, 4, 'Fix mobile layout', 'Resolve responsive layout issues', 'pending', '2026-10-23', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(12, 4, 'Review pull request', 'Review recent code changes', 'pending', '2026-10-27', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(13, 5, 'Connect robot', 'Connect ESP32 to dashboard', 'completed', '2026-10-08', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(14, 5, 'Add sensor readings', 'Display live sensor values', 'in_progress', '2026-10-20', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(15, 5, 'Secure endpoints', 'Add authentication checks', 'pending', '2026-10-24', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(16, 5, 'Test controls', 'Verify remote controls work', 'pending', '2026-10-28', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(17, 6, 'Build search', 'Add recipe search functionality', 'completed', '2026-10-09', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(18, 6, 'Add favourites', 'Allow users to save recipes', 'in_progress', '2026-10-21', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(19, 6, 'Write documentation', 'Document application features', 'pending', '2026-10-25', '2026-10-17 10:15:11', '2026-10-17 10:15:11'),
(20, 6, 'Run final tests', 'Test all user flows', 'pending', '2026-10-29', '2026-10-17 10:15:11', '2026-10-17 10:15:11');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(10) UNSIGNED NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(30) NOT NULL,
  `occupation` varchar(30) NOT NULL DEFAULT 'other',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `first_name`, `last_name`, `username`, `password`, `email`, `phone`, `created_at`) VALUES
(1, 'Fernando', 'Rere', 'southgun234', 'scrypt:32768:8:1$NBVliKO4KyQNNjRf$a35f0e779ae4fe0b271d339f469598a79212f7181c8107301b4649bbcc69b5b51cd7c27d1f0f9f6e5d50c4633196be835d66c65a9457ca4766e5ad8c848d0a8a', 'fernandokiprere0482@gmail.com', '+254(725) (077) (631)', '2026-10-17 10:08:08'),
(2, 'Alex', 'Morgan', 'mock_alex', 'MOCK_PASSWORD_NOT_FOR_LOGIN', 'alex.mock@example.com', '+254700000001', '2026-10-17 10:15:11'),
(3, 'Jamie', 'Kim', 'mock_jamie', 'MOCK_PASSWORD_NOT_FOR_LOGIN', 'jamie.mock@example.com', '+254700000002', '2026-10-17 10:15:11'),
(4, 'Taylor', 'Reed', 'mock_taylor', 'MOCK_PASSWORD_NOT_FOR_LOGIN', 'taylor.mock@example.com', '+254700000003', '2026-10-17 10:15:11'),
(5, 'Jordan', 'Blake', 'mock_jordan', 'MOCK_PASSWORD_NOT_FOR_LOGIN', 'jordan.mock@example.com', '+254700000004', '2026-10-17 10:15:11'),
(6, 'Casey', 'Rivera', 'mock_casey', 'MOCK_PASSWORD_NOT_FOR_LOGIN', 'casey.mock@example.com', '+254700000005', '2026-10-17 10:15:11'),
(7, 'security_alex', 'qwertyuio', 'security_alex', 'scrypt:32768:8:1$sV2tEJPaN4tOanY9$fd82d73eeaca3e95a17c543d983eee18bbeaeda597bee88fde04a99447802ba895bf62c8cb42d1c39cfaca6aca11775ca13aba0e2ab65d2f8f631c5cb49b10d6', 'alex123@gmail.com', '+254(723) (456) (789)', '2026-10-17 10:27:53'),
(8, 'security_jane', 'qwertyuio', 'security_jane', 'scrypt:32768:8:1$6D3AKYW9IqL4aoI8$dea2135fbe65479724bb8f1990e75172215e09d33d7e66cc4267ae33914c814c865e17296fff27d15c63461e191b9eb6e660c9ee2b70b431a4c13ed907e4cd33', 'jane123@gmail.com', '+254(723) (456) (780)', '2026-10-17 10:28:33');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `expenses`
--
ALTER TABLE `expenses`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_expenses_user` (`user_id`),
  ADD KEY `idx_expenses_date` (`expense_date`);

--
-- Indexes for table `notes`
--
ALTER TABLE `notes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_notes_user` (`user_id`);

--
-- Indexes for table `projects`
--
ALTER TABLE `projects`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_projects_user` (`user_id`);

--
-- Indexes for table `tasks`
--
ALTER TABLE `tasks`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tasks_user` (`user_id`),
  ADD KEY `idx_tasks_status` (`status`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`),
  ADD UNIQUE KEY `email` (`email`),
  ADD UNIQUE KEY `phone` (`phone`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `expenses`
--
ALTER TABLE `expenses`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=21;

--
-- AUTO_INCREMENT for table `notes`
--
ALTER TABLE `notes`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT for table `projects`
--
ALTER TABLE `projects`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=18;

--
-- AUTO_INCREMENT for table `tasks`
--
ALTER TABLE `tasks`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=21;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=9;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `expenses`
--
ALTER TABLE `expenses`
  ADD CONSTRAINT `fk_expenses_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `notes`
--
ALTER TABLE `notes`
  ADD CONSTRAINT `fk_notes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `projects`
--
ALTER TABLE `projects`
  ADD CONSTRAINT `fk_projects_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `tasks`
--
ALTER TABLE `tasks`
  ADD CONSTRAINT `fk_tasks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
